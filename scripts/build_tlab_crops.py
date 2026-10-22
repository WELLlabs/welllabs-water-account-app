"""Build the T-Lab crop survey layer from the Karnataka crop survey and upload it to S3.

The Karnataka crop survey (cropsurvey.karnataka.gov.in) records the crop grown on every
survey number each season, but only answers one survey number at a time. Following
https://github.com/karanmisq/Crop-Survey, the survey numbers to ask for come from the KGIS
cadastral map (kgis.ksrsac.in), whose village codes are the crop survey's dropdown values:

    KGIS village code DDTTHH VVVV -> district DD, taluk TT, hobli HH, village VVVV

Each survey number's KGIS parcels also place it on the S2 level-13 grid, so crop areas are
summed per cell and per village. Owner names, survey numbers and plot rows are never
kept: every answer is folded into those totals as soon as it is read.

Scraping takes hours per season, so finished villages are checkpointed under
.cache/tlab_crops/ (totals only) and a rerun resumes where it stopped.

    api/.venv/bin/python scripts/build_tlab_crops.py scrape [--seasons 2025 2025_Rabi] [--villages 5]
    api/.venv/bin/python scripts/build_tlab_crops.py publish

`scrape` without --seasons does every season of YEARS the site serves, newest first.
`publish` packs the finished seasons of YEARS into TLAB_CROPS_KEY (gzipped JSON) on S3.
"""

from __future__ import annotations

import argparse
import datetime
import difflib
import gzip
import html
import json
import os
import re
import sys
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import boto3
import httpx
import s2sphere
from dotenv import load_dotenv
from shapely.geometry import Polygon, mapping

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from api.crop_names import crop_en, parse_extent  # noqa: E402

load_dotenv(ROOT / ".env")

BUCKET = os.environ.get("TLAB_LAYERS_BUCKET") or os.environ.get("AWS_S3_BUCKET_NAME")
KEY = os.environ.get("TLAB_CROPS_KEY", "Raichur_crop_survey.json.gz")
CACHE = ROOT / ".cache" / "tlab_crops"

DISTRICT = "06"  # Raichur in both KGIS and the crop survey
KGIS = "https://kgis.ksrsac.in/kgismaps2/rest/services/CadastralData_Admin/Dynamic_CadastralData_Admin/MapServer"
SURVEY = "https://cropsurvey.karnataka.gov.in/{season}/MISReports/frmGetFruitDetails.aspx"
HISSA = "https://cropsurvey.karnataka.gov.in/{season}/CropSurveyDetails/frmnagovtaquiredd.aspx"
YEARS = (2025, 2024)
SEASON_KINDS = [("", "Kharif"), ("_Rabi", "Rabi"), ("_Summer", "Summer")]
CELL_LEVEL = 13
WORKERS = 8
NAME_MATCH_MIN = 0.6
UA = {"User-Agent": "Mozilla/5.0 (WELL Labs T-Lab crop survey summary)"}

_local = threading.local()
_modes_lock = threading.Lock()


def client() -> httpx.Client:
    c = getattr(_local, "client", None)
    if c is None:
        c = _local.client = httpx.Client(headers=UA, timeout=90, follow_redirects=False)
    return c


def retry(fn, what: str, tries: int = 5):
    for attempt in range(tries):
        try:
            return fn()
        except Exception as e:
            if attempt == tries - 1:
                raise RuntimeError(f"{what}: {e}") from e
            time.sleep(3 * (attempt + 1))


# ── KGIS: villages and survey-number parcels ────────────────────────────────


def kgis(layer: int, **params) -> dict:
    def go():
        js = client().post(f"{KGIS}/{layer}/query", data={"f": "json", **params}).raise_for_status().json()
        if "error" in js:
            raise RuntimeError(js["error"])
        return js

    return retry(go, f"KGIS layer {layer}")


def esri_polygon(rings: list) -> Polygon | None:
    shells = [Polygon(r) for r in rings if len(r) >= 4]
    shells = [p for p in shells if p.is_valid and not p.is_empty]
    return max(shells, key=lambda p: p.area) if shells else None


def villages() -> list[dict]:
    path = CACHE / "villages.json"
    if path.exists():
        return json.loads(path.read_text())
    js = kgis(
        4,
        where=f"KGISVillageCode LIKE '{DISTRICT}%'",
        outFields="KGISVillageCode,KGISVillageName",
        returnGeometry="true",
        outSR="4326",
        maxAllowableOffset="0.0003",
        geometryPrecision="5",
        resultRecordCount="2000",
    )
    by_code: dict[str, dict] = {}
    for f in js["features"]:
        code = f["attributes"]["KGISVillageCode"]
        poly = esri_polygon(f["geometry"]["rings"]) if f.get("geometry") else None
        v = by_code.setdefault(code, {"code": code, "name": f["attributes"]["KGISVillageName"], "parts": []})
        if poly is not None:
            v["parts"].append(mapping(poly))
    out = sorted(by_code.values(), key=lambda v: v["code"])
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out))
    return out


def cell_of(lat: float, lng: float) -> str:
    return str(s2sphere.CellId.from_lat_lng(s2sphere.LatLng.from_degrees(lat, lng)).parent(CELL_LEVEL).id())


def survey_cells(code: str) -> dict[int, list[tuple[str, float]]]:
    """Survey number -> [(cell, share of the survey's mapped area)]."""
    path = CACHE / "kgis" / f"{code}.json"
    if path.exists():
        return {int(k): [tuple(x) for x in v] for k, v in json.loads(path.read_text()).items()}
    ids = sorted(kgis(5, where=f"KGISVillageCode='{code}' AND surveynumberi>0", returnIdsOnly="true").get("objectIds") or [])
    area: dict[int, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for i in range(0, len(ids), 500):
        js = kgis(
            5,
            objectIds=",".join(map(str, ids[i : i + 500])),
            outFields="surveynumberi,SHAPE.STArea()",
            returnGeometry="true",
            outSR="4326",
            maxAllowableOffset="0.00005",
            geometryPrecision="6",
        )
        for f in js["features"]:
            poly = esri_polygon(f["geometry"]["rings"]) if f.get("geometry") else None
            if poly is None:
                continue
            p = poly.representative_point()
            m2 = f["attributes"].get("SHAPE.STArea()") or 0.0
            area[int(f["attributes"]["surveynumberi"])][cell_of(p.y, p.x)] += max(m2, 1.0)
    out = {}
    for s, cells in area.items():
        total = sum(cells.values())
        out[s] = [(c, round(a / total, 4)) for c, a in cells.items()]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out))
    return out


# ── Crop survey site ────────────────────────────────────────────────────────

HIDDEN = re.compile(r'<input type="hidden" name="([^"]+)" id="[^"]*" value="([^"]*)"')
ROW = re.compile(r"<tr.*?</tr>", re.S)
CELL = re.compile(r"<td[^>]*>(.*?)</td>", re.S)
TAG = re.compile(r"<[^>]+>")


def hidden(page: str) -> dict:
    return {k: html.unescape(v) for k, v in HIDDEN.findall(page)}


def options(page: str, sid: str) -> dict[str, str]:
    m = re.search(rf'<select[^>]*id="{sid}"[^>]*>(.*?)</select>', page, re.S)
    if not m:
        return {}
    opts = re.findall(r'<option[^>]*value="([^"]*)"[^>]*>(.*?)</option>', m.group(1), re.S)
    return {v: html.unescape(n).strip() for v, n in opts if v not in ("", "0")}


def text(s: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(TAG.sub(" ", s))).strip()


def same_name(a: str, b: str) -> float:
    """Similarity of two spellings of a village name, ignoring word order ("Lingasugur Kasaba")."""
    words = lambda s: re.sub(r"[^a-z ]", " ", s.lower()).split()
    ratio = lambda x, y: difflib.SequenceMatcher(None, x, y).ratio()
    wa, wb = words(a), words(b)
    return max(ratio("".join(wa), "".join(wb)), ratio("".join(sorted(wa)), "".join(sorted(wb))))


def seasons_available() -> list[tuple[str, str, int]]:
    """(url key, label, year) for every season page in YEARS with the report form, newest first."""
    out = []
    for year in YEARS:
        for suffix, kind in SEASON_KINDS:
            key = f"{year}{suffix}"
            try:
                r = client().get(SURVEY.format(season=key))
            except httpx.HTTPError:
                continue
            if r.status_code == 200 and 'id="ddlDistrict"' in r.text and 'id="txtSurvey"' in r.text:
                out.append((key, f"{kind} {year}", year))
    return out



def crop_name(s: str) -> str:
    """Drop the variety suffix: "ಹತ್ತಿ-H", "ಸಜ್ಜೆ - ಸ್ಥಳೀಯ" (local)."""
    return re.split(r"\s*-\s*", s.strip(), maxsplit=1)[0] or "?"


def table_rows(page: str, table_id: str) -> list[tuple[str, list[str]]] | None:
    """(row html, cell texts) for each data row of a grid; None if the grid is absent."""
    table = re.search(rf'<table[^>]*id="{table_id}".*?</table>', page, re.S)
    if not table:
        return None
    out = []
    for tr in ROW.findall(table.group(0))[1:]:
        cells = [text(x) for x in CELL.findall(tr)]
        if cells:
            out.append((tr, cells))
    return out


def same_survey(label: str, number: int) -> bool:
    return label == str(number) or label.startswith(f"{number}/")


class Village:
    """One village opened on one season's crop survey page.

    "report" is the MIS report (one request per survey number, all hissas at once), which
    has data from Kharif 2022. "hissa" is the per-hissa page the Summer survey uses, which
    also holds 2019-2021 but needs one more request per hissa.
    """

    def __init__(self, season: str, code: str, name: str, mode: str = "report"):
        self.url = (SURVEY if mode == "report" else HISSA).format(season=season)
        self.mode = mode
        self.code, self.name = code, name
        self.vals: dict[str, str] = {}
        self.page = ""
        self.site_name: str | None = None

    def post(self, data: dict) -> str:
        return retry(lambda: client().post(self.url, data=data).raise_for_status().text, self.url)

    def open(self) -> bool:
        self.page = retry(lambda: client().get(self.url).raise_for_status().text, self.url)
        parts = [("ddlDistrict", self.code[0:2]), ("drpTaluk", self.code[2:4]), ("drpHobli", self.code[4:6])]
        for sid, part in parts:
            self.vals[sid] = str(int(part))
            if self.vals[sid] not in options(self.page, sid):
                return False
            self.page = self.post({**hidden(self.page), "__EVENTTARGET": sid, "__EVENTARGUMENT": "", **self.vals})
        opts = options(self.page, "ddlVillage")
        want = str(int(self.code[6:10]))
        if want in opts:
            # Trust the KGIS village code when the site lists it. Names often differ
            # ("Baladhaamanikere" vs "AMANIBALLADAKERE") and a name check rejects real villages.
            pick = want
        else:
            # Code missing from this hobli (renumbered villages): fall back to name match.
            scored = sorted(((same_name(n, self.name), v) for v, n in opts.items()), reverse=True)
            if not scored or scored[0][0] < 0.8:
                return False
            pick = scored[0][1]
        self.vals["ddlVillage"] = pick
        self.site_name = opts[pick]
        return True

    def survey(self, number: int) -> list[tuple[str, float]] | None:
        """[(crop, ha)] for one survey number; None if the site has nothing for it."""
        page = self.post(
            {
                **hidden(self.page),
                "__EVENTTARGET": "",
                "__EVENTARGUMENT": "",
                **self.vals,
                "txtSurvey": str(number),
                "btnGetDetails": "Get Crop Survey Details",
            }
        )
        rows = table_rows(page, "GrdCropExtent")
        if rows is None:
            return None
        self.page = page
        return self.report_rows(rows, number) if self.mode == "report" else self.hissa_rows(rows, number)

    @staticmethod
    def report_rows(rows: list[tuple[str, list[str]]], number: int) -> list[tuple[str, float]]:
        seen, out = set(), []
        for _, c in rows:
            if len(c) < 8 or not same_survey(c[4], number):
                continue
            # survey/hissa, land code, owner no, crop, extent identify a row; the owner name is not kept
            ident = (c[4], c[8] if len(c) > 8 else "", c[9] if len(c) > 9 else "", c[7], c[6])
            if ident in seen:
                continue
            seen.add(ident)
            ha = parse_extent(c[6])
            if ha:
                out.append((crop_name(c[7]), ha))
        return out

    def hissa_rows(self, rows: list[tuple[str, list[str]]], number: int) -> list[tuple[str, float]]:
        """Open each hissa's crop table. Joint owners of a hissa repeat the same table, so
        rows are keyed by hissa, crop and extent."""
        radios = []
        for tr, _ in rows:
            m = re.search(r'<input[^>]*type="radio"[^>]*>', tr)
            if m:
                name = re.search(r'name="([^"]+)"', m.group(0))
                value = re.search(r'value="([^"]+)"', m.group(0))
                if name and value:
                    radios.append((html.unescape(name.group(1)), html.unescape(value.group(1))))
        seen, out = set(), []
        for name, value in radios:
            page = self.post(
                {
                    **hidden(self.page),
                    "__EVENTTARGET": name,
                    "__EVENTARGUMENT": "",
                    **self.vals,
                    "txtSurvey": str(number),
                    name: value,
                }
            )
            crops = table_rows(page, "grdCropSurvey")
            if crops is None:
                continue
            self.page = page
            for _, c in crops:
                if len(c) < 7 or not same_survey(c[5], number):
                    continue
                ident = (c[5], c[4], c[6])
                if ident in seen:
                    continue
                seen.add(ident)
                ha = parse_extent(c[6])
                if ha:
                    out.append((crop_name(c[4]), ha))
        return out


def season_mode(season: str, vs: list[dict], sample_villages: int = 4, sample_surveys: int = 25) -> str:
    """Which page holds this season's data: "report", "hissa" or "none" (decided once, by sampling)."""
    path = CACHE / "modes.json"
    with _modes_lock:
        modes = json.loads(path.read_text()) if path.exists() else {}
    if season in modes:
        return modes[season]
    found = "none"
    for mode in ("report", "hissa"):
        for v in vs[:sample_villages]:
            site = Village(season, v["code"], v["name"], mode)
            try:
                if not site.open():
                    continue
                numbers = sorted(survey_cells(v["code"]))[:sample_surveys]
                if any(site.survey(n) for n in numbers):
                    found = mode
                    break
            except RuntimeError:
                continue
        if found != "none":
            break
    with _modes_lock:
        modes = json.loads(path.read_text()) if path.exists() else {}
        modes[season] = found
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(modes, indent=1))
    return found


def scrape_village(season: str, v: dict, mode: str) -> dict:
    path = CACHE / season / f"{v['code']}.json"
    if path.exists():
        return json.loads(path.read_text())
    surveys = survey_cells(v["code"])
    site = Village(season, v["code"], v["name"], mode)
    result: dict = {"code": v["code"], "mode": mode, "surveys": len(surveys), "answered": 0, "crops": {}, "cells": {}}
    if not site.open():
        result["status"] = "not on site"
    else:
        result["status"] = "done"
        result["siteName"] = site.site_name
        crops: dict[str, float] = defaultdict(float)
        cells: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
        for number, shares in sorted(surveys.items()):
            rows = site.survey(number)
            if rows is None:
                continue
            result["answered"] += 1
            for crop, ha in rows:
                crops[crop] += ha
                for cell, share in shares:
                    cells[cell][crop] += ha * share
        result["crops"] = {k: round(a, 3) for k, a in crops.items()}
        result["cells"] = {c: {k: round(a, 3) for k, a in m.items()} for c, m in cells.items()}
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(result, ensure_ascii=False))
    tmp.replace(path)
    return result


def scrape(season_keys: list[str], limit: int | None) -> None:
    vs = villages()
    if limit:
        vs = vs[:limit]
    print(f"{len(vs)} villages")
    for season in season_keys:
        mode = season_mode(season, villages())
        if mode == "none":
            print(f"\n== {season}: no crop data on the site, skipped", flush=True)
            continue
        todo = [v for v in vs if not (CACHE / season / f"{v['code']}.json").exists()]
        print(f"\n== {season} ({mode} page): {len(todo)} of {len(vs)} villages to do", flush=True)
        t0, done, answered = time.time(), 0, 0
        with ThreadPoolExecutor(WORKERS) as pool:
            futs = {pool.submit(scrape_village, season, v, mode): v for v in todo}
            for f in as_completed(futs):
                v = futs[f]
                done += 1
                try:
                    r = f.result()
                except Exception as e:
                    print(f"  {v['code']} {v['name']}: FAILED {e}", flush=True)
                    continue
                answered += r["answered"]
                top = sorted(r["crops"].items(), key=lambda kv: -kv[1])[:3]
                rate = answered / max(time.time() - t0, 1)
                print(
                    f"  [{done}/{len(todo)}] {v['code']} {v['name']} ({r.get('siteName', '-')}): {r['status']}, "
                    f"{r['answered']}/{r['surveys']} surveys, {sum(r['crops'].values()):.0f} ha "
                    f"{', '.join(f'{k} {a:.0f}' for k, a in top)} · {rate:.1f} surveys/s",
                    flush=True,
                )


# ── Publish ─────────────────────────────────────────────────────────────────


def publish(dry_run: bool) -> None:
    vs = villages()
    codes = {v["code"] for v in vs}
    available = {k: (label, year) for k, label, year in seasons_available()}
    seasons = []
    crop_idx: dict[str, int] = {}
    crops: list[dict] = []

    def idx(name: str) -> int:
        if name not in crop_idx:
            crop_idx[name] = len(crops)
            crops.append({"kn": name, "en": crop_en(name)})
        return crop_idx[name]

    for d in sorted(p for p in CACHE.iterdir() if p.is_dir() and p.name in available):
        results = [json.loads(p.read_text()) for p in d.glob("*.json")]
        results = [r for r in results if r["code"] in codes]
        if not results:
            continue
        label, year = available.get(d.name, (d.name, int(d.name[:4])))
        district: dict[int, float] = defaultdict(float)
        by_village, by_cell = {}, defaultdict(lambda: defaultdict(float))
        for r in results:
            if r["status"] != "done" or not r["crops"]:
                continue
            row = {idx(k): a for k, a in r["crops"].items()}
            by_village[r["code"]] = [[i, round(a, 2)] for i, a in sorted(row.items(), key=lambda kv: -kv[1])]
            for i, a in row.items():
                district[i] += a
            for cell, m in r["cells"].items():
                for k, a in m.items():
                    by_cell[cell][idx(k)] += a
        seasons.append(
            {
                "key": d.name,
                "label": label,
                "year": year,
                "kind": label.split()[0],
                "villages": {"total": len(vs), "scraped": len(results), "withData": len(by_village)},
                "surveys": {"asked": sum(r["surveys"] for r in results), "answered": sum(r["answered"] for r in results)},
                "district": [[i, round(a, 1)] for i, a in sorted(district.items(), key=lambda kv: -kv[1])],
                "villageCrops": by_village,
                "cellCrops": {
                    c: [[i, round(a, 2)] for i, a in sorted(m.items(), key=lambda kv: -kv[1]) if a >= 0.01]
                    for c, m in by_cell.items()
                },
            }
        )
    seasons.sort(key=lambda s: (s["year"], ["Kharif", "Rabi", "Summer"].index(s["kind"]) if s["kind"] in ("Kharif", "Rabi", "Summer") else 9))
    payload = {
        "version": 1,
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "region": "Raichur",
        "source": {"survey": "https://cropsurvey.karnataka.gov.in/", "cadastral": "https://kgis.ksrsac.in/"},
        "crops": crops,
        "villages": [{"code": v["code"], "name": v["name"]} for v in vs],
        "seasons": seasons,
    }
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    packed = gzip.compress(raw, 9)
    for s in seasons:
        top = ", ".join(f"{crops[i]['en']} {a:,.0f}" for i, a in s["district"][:5])
        print(f"{s['label']:12} villages {s['villages']['withData']}/{s['villages']['total']} · {top}")
    print(f"{len(crops)} crops · {len(raw) / 1e6:.1f} MB json, {len(packed) / 1e6:.2f} MB gzipped")
    unnamed = [c["kn"] for c in crops if c["kn"] == c["en"]]
    if unnamed:
        print("No English name yet:", ", ".join(unnamed))
    if dry_run:
        return
    if not BUCKET:
        sys.exit("No bucket configured (AWS_S3_BUCKET_NAME).")
    boto3.client("s3", region_name=os.environ.get("AWS_DEFAULT_REGION", "ap-south-1")).put_object(
        Bucket=BUCKET, Key=KEY, Body=packed, ContentType="application/json", ContentEncoding="gzip"
    )
    print(f"uploaded s3://{BUCKET}/{KEY}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    sp = sub.add_parser("scrape")
    sp.add_argument("--seasons", nargs="*", help="season keys such as 2025 or 2025_Rabi (default: all)")
    sp.add_argument("--villages", type=int, help="only the first N villages (for a trial run)")
    sub.add_parser("seasons")
    pp = sub.add_parser("publish")
    pp.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.cmd == "seasons":
        for key, label, _ in seasons_available():
            print(f"{key:14} {label}")
    elif args.cmd == "scrape":
        keys = args.seasons or [k for k, _, _ in seasons_available()]
        scrape(keys, args.villages)
    else:
        publish(args.dry_run)


if __name__ == "__main__":
    main()
