"""Crop-survey rows from the Raichur FRUITS scrape (raichur_raw), keyed by village.

Owner names and owner numbers are never stored. The map files live on S3 under
TLAB_RAW_CROPS_PREFIX (district snapshot plus one gzipped JSON per village). Local
CSVs in data-scraping/raichur_raw are only used to rebuild those files.
"""

from __future__ import annotations

import csv
import gzip
import json
import logging
import os
import threading
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

from .crop_names import crop_en, parse_extent
from .layers import BUCKET, _Layer, _respond

ROOT = Path(__file__).resolve().parent.parent

log = logging.getLogger(__name__)

router = APIRouter(prefix="/fwa-api/tlab/layers")

RAW_DIR = Path(os.environ.get("TLAB_RAW_CROPS_DIR", ROOT / "data-scraping" / "raichur_raw"))
PREFIX = os.environ.get("TLAB_RAW_CROPS_PREFIX", "Raichur_raw_crops/")
CACHE = ROOT / ".cache" / "tlab_raw_crops"
READY = CACHE / "_ready.json"
SNAPSHOT = CACHE / "_snapshot.json.gz"
INDEX_VERSION = 2
VILLAGE_CACHE = 200

_lock = threading.Lock()
_ready: dict | None = None

KIND_ORDER = {"Kharif": 0, "Rabi": 1, "Summer": 2}


def plot_key(label: str) -> str:
    """Common form of KGIS ("330/1") and crop survey ("330/*/1") hissa labels."""
    return "/".join(p for p in label.upper().split("/") if p.strip() not in ("", "*"))


def _pairs(m: dict[int, float], nd: int = 3) -> list[list[float | int]]:
    return [[i, round(a, nd)] for i, a in sorted(m.items(), key=lambda kv: -kv[1])]


def _season_meta(key: str) -> tuple[str, int, str]:
    year = int(key[:4])
    kind = "Rabi" if key.endswith("_Rabi") else "Summer" if key.endswith("_Summer") else "Kharif"
    return kind, year, f"{kind} {year}"


def _index() -> dict:
    if not RAW_DIR.is_dir():
        raise FileNotFoundError(f"Raichur raw scrape not found at {RAW_DIR}")
    csvs = sorted(RAW_DIR.glob("20*.csv"))
    if not csvs:
        raise FileNotFoundError(f"No year CSVs in {RAW_DIR}")

    villages: dict[str, dict] = {}
    global_crops: list[dict] = []
    global_idx: dict[str, int] = {}
    season_district: dict[str, dict[int, float]] = defaultdict(lambda: defaultdict(float))
    season_village: dict[str, dict[str, dict[int, float]]] = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
    season_surveys: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    rows_n = 0
    t0 = time.time()
    for path in csvs:
        with path.open(newline="", encoding="utf-8-sig") as fh:
            for row in csv.DictReader(fh):
                code = (row.get("KGISCode") or "").strip()
                if len(code) != 10 or not code.isdigit():
                    continue
                ha = parse_extent(row.get("Extent") or "")
                if not ha:
                    continue
                season = (row.get("season_key") or "").strip()
                survey = (row.get("Survey queried") or "").strip()
                if not season or not survey:
                    continue
                orig = (row.get("Crop Detail") or "").strip()
                crop = crop_en(orig)
                label = (row.get("Survey No") or "").strip()
                v = villages.get(code)
                if v is None:
                    v = {
                        "village": code,
                        "name": (row.get("KGIS_village_name") or "").strip(),
                        "crops": [],
                        "crop_idx": {},
                        "surveys": defaultdict(lambda: defaultdict(lambda: defaultdict(float))),
                        "hissas": defaultdict(lambda: defaultdict(lambda: defaultdict(float))),
                        "seasons": set(),
                    }
                    villages[code] = v
                idx = v["crop_idx"].get(crop)
                if idx is None:
                    idx = len(v["crops"])
                    v["crops"].append(crop)
                    v["crop_idx"][crop] = idx
                gi = global_idx.get(crop)
                if gi is None:
                    gi = len(global_crops)
                    global_crops.append({"kn": orig or crop, "en": crop})
                    global_idx[crop] = gi
                v["seasons"].add(season)
                v["surveys"][survey][season][idx] += ha
                key = plot_key(label) if label else survey
                if key and key != survey:
                    v["hissas"][key][season][idx] += ha
                season_district[season][gi] += ha
                season_village[season][code][gi] += ha
                season_surveys[season][code].add(survey)
                rows_n += 1

    CACHE.mkdir(parents=True, exist_ok=True)
    seasons: set[str] = set()
    for code, v in villages.items():
        seasons.update(v["seasons"])
        body = {
            "village": code,
            "name": v["name"],
            "seasons": sorted(v["seasons"]),
            "crops": v["crops"],
            "surveys": {
                s: {k: _pairs(m) for k, m in seasons_m.items()} for s, seasons_m in v["surveys"].items()
            },
            "hissas": {
                h: {k: _pairs(m) for k, m in seasons_m.items()} for h, seasons_m in v["hissas"].items()
            },
        }
        packed = gzip.compress(json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode(), 6)
        (CACHE / f"{code}.json.gz").write_bytes(packed)

    generated = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    n_villages = len(villages)
    seasons_out = []
    for key in season_district:
        kind, year, label = _season_meta(key)
        vmap = season_village[key]
        n_surveys = sum(len(s) for s in season_surveys[key].values())
        seasons_out.append(
            {
                "key": key,
                "label": label,
                "year": year,
                "kind": kind,
                "villages": {"total": n_villages, "scraped": n_villages, "withData": len(vmap)},
                "surveys": {"asked": n_surveys, "answered": n_surveys},
                "district": _pairs(season_district[key], 1),
                "villageCrops": {c: _pairs(m, 2) for c, m in vmap.items()},
                "cellCrops": {},
            }
        )
    seasons_out.sort(key=lambda s: (s["year"], KIND_ORDER.get(s["kind"], 9)))
    snap = {
        "version": 1,
        "generatedAt": generated,
        "region": "Raichur",
        "source": {
            "dir": "data-scraping/raichur_raw",
            "bucket": PREFIX.rstrip("/"),
            "survey": "https://cropsurvey.karnataka.gov.in/",
        },
        "crops": global_crops,
        "villages": [{"code": c, "name": villages[c]["name"]} for c in sorted(villages)],
        "seasons": seasons_out,
    }
    SNAPSHOT.write_bytes(gzip.compress(json.dumps(snap, ensure_ascii=False, separators=(",", ":")).encode(), 6))

    meta = {
        "version": INDEX_VERSION,
        "villages": n_villages,
        "rows": rows_n,
        "seasons": sorted(seasons),
        "generatedAt": generated,
        "secs": round(time.time() - t0, 1),
    }
    READY.write_text(json.dumps(meta))
    log.info(
        "Indexed Raichur raw crop survey: %s villages, %s rows, %s s → %s",
        meta["villages"],
        f"{rows_n:,}",
        meta["secs"],
        CACHE,
    )
    return meta


def ensure_index() -> dict:
    global _ready
    if _ready is not None:
        return _ready
    with _lock:
        if _ready is not None:
            return _ready
        if READY.exists() and SNAPSHOT.exists():
            meta = json.loads(READY.read_text())
            if meta.get("version") == INDEX_VERSION:
                _ready = meta
                return _ready
        _ready = _index()
        return _ready


def _s3_file(name: str, encoding: str | None = "gzip") -> _Layer:
    entry = _Layer("TLAB_RAW_CROPS_PREFIX", lambda raw: raw, "application/json", encoding)
    entry.key = f"{PREFIX}{name}"
    return entry


def _local_gzip(path: Path) -> Response:
    if not path.exists():
        raise HTTPException(status_code=404, detail="Raichur raw crop file missing")
    return Response(
        content=path.read_bytes(),
        media_type="application/json",
        headers={
            "Content-Encoding": "gzip",
            "Cache-Control": "public, max-age=3600",
            "Vary": "Accept-Encoding",
        },
    )


def _serve(entry: _Layer, request: Request, local: Path | None = None) -> Response:
    if BUCKET:
        try:
            return _respond(entry, request)
        except HTTPException as e:
            if e.status_code not in (502, 503) or local is None:
                raise
            log.warning("Serving %s from disk; S3 unavailable: %s", local.name, e.detail)
    if local is not None:
        return _local_gzip(local)
    raise HTTPException(status_code=503, detail="No layer bucket configured (set AWS_S3_BUCKET_NAME).")


_snapshot = _s3_file("_snapshot.json.gz")
_meta = _s3_file("_ready.json", encoding=None)
_villages: dict[str, _Layer] = {}
_village_lock = threading.Lock()


@router.get("/raw-crops")
def raw_crops_snapshot(request: Request):
    return _serve(_snapshot, request, SNAPSHOT)


@router.get("/raw-crops/meta")
def raw_crops_meta(request: Request):
    if BUCKET:
        try:
            return _respond(_meta, request)
        except HTTPException as e:
            if e.status_code not in (502, 503):
                raise
            log.warning("Serving raw-crops meta from disk; S3 unavailable: %s", e.detail)
    try:
        return ensure_index()
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from None


@router.get("/raw-crops/{village}.json")
def village_raw_crops(village: str, request: Request):
    if not (len(village) == 10 and village.isdigit()):
        raise HTTPException(status_code=404, detail="Unknown village")
    with _village_lock:
        entry = _villages.pop(village, None)
        if entry is None:
            entry = _s3_file(f"{village}.json.gz")
        _villages[village] = entry
        while len(_villages) > VILLAGE_CACHE:
            _villages.pop(next(iter(_villages)))
    return _serve(entry, request, CACHE / f"{village}.json.gz")
