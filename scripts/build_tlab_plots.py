"""Raichur plot-level crop survey: KGIS cadastral parcels with each survey number's crops.

For every village this saves the KGIS cadastral parcels (outline, survey number, hissa
label) and, for each season, the crop survey's rows for every survey number (hissa label,
crop, extent). Owner names and owner numbers are never kept.

    api/.venv/bin/python -u scripts/build_tlab_plots.py scrape [--seasons 2025 2025_Rabi] [--villages 5]
    api/.venv/bin/python scripts/build_tlab_plots.py export
    api/.venv/bin/python scripts/build_tlab_plots.py publish [--dry-run]

Villages are checkpointed under .cache/tlab_plots/ and a rerun resumes where it stopped.
`publish` uploads the map files: one per village under TLAB_PLOTS_PREFIX (parcels with
crops per survey number and hissa) and the village boundaries as TLAB_VILLAGES_KEY.
`export` writes .cache/tlab_plots/Raichur_plots.gpkg with three layers:
  parcels         every KGIS parcel, with crops where its hissa label matches a survey row
  survey_numbers  parcels dissolved per survey number, with main crop and all crops per season
  crop_rows       one row per survey row (village, survey, hissa, season, crop, ha)
"""

from __future__ import annotations

import argparse
import gzip
import json
import os
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from shapely.geometry import LinearRing, MultiPolygon, Polygon, mapping, shape

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_tlab_crops as bc  # noqa: E402

OUT = bc.ROOT / ".cache" / "tlab_plots"
SEASONS = ["2025", "2025_Rabi"]
PLOTS_PREFIX = os.environ.get("TLAB_PLOTS_PREFIX", "Raichur_crop_plots/")
VILLAGES_KEY = os.environ.get("TLAB_VILLAGES_KEY", "Raichur_villages.geojson.gz")
SIMPLIFY_DEG = 0.000005  # about 0.5 m
PARCEL_FIELDS = (
    "OBJECTID,KGISVillageCode,surveynumberi,Label,HissaNo,Surnoc,Category,Kharab,"
    "Surveynumber_Old,LGD_VillageCode,ULPIN,SHAPE.STArea()"
)
BATCH = 200


# ── KGIS parcels ────────────────────────────────────────────────────────────


def esri_geometry(rings: list) -> Polygon | MultiPolygon | None:
    """Esri rings (outer clockwise, holes counter-clockwise) to a shapely polygon."""
    shells, holes = [], []
    for r in rings:
        if len(r) < 4:
            continue
        (holes if LinearRing(r).is_ccw else shells).append(r)
    polys = []
    for s in shells:
        outer = Polygon(s)
        inner = [h for h in holes if outer.contains(Polygon(h).representative_point())]
        p = Polygon(s, inner)
        polys.append(p if p.is_valid else p.buffer(0))
    polys = [p for p in polys if not p.is_empty]
    if not polys:
        return None
    return polys[0] if len(polys) == 1 else MultiPolygon([g for p in polys for g in getattr(p, "geoms", [p])])


def kgis_batch(ids: list[int]) -> list[dict]:
    try:
        return bc.kgis(
            5,
            objectIds=",".join(map(str, ids)),
            outFields=PARCEL_FIELDS,
            returnGeometry="true",
            outSR="4326",
            geometryPrecision="7",
        )["features"]
    except RuntimeError:
        if len(ids) <= 20:
            raise
        half = len(ids) // 2
        return kgis_batch(ids[:half]) + kgis_batch(ids[half:])


def parcels(code: str) -> list[dict]:
    """GeoJSON features for every KGIS parcel in a village (cached)."""
    path = OUT / "parcels" / f"{code}.geojson"
    if path.exists():
        return json.loads(path.read_text())["features"]
    ids = sorted(bc.kgis(5, where=f"KGISVillageCode='{code}'", returnIdsOnly="true").get("objectIds") or [])
    feats = []
    for i in range(0, len(ids), BATCH):
        for f in kgis_batch(ids[i : i + BATCH]):
            geom = esri_geometry(f["geometry"]["rings"]) if f.get("geometry") else None
            if geom is None:
                continue
            a = f["attributes"]
            feats.append(
                {
                    "type": "Feature",
                    "geometry": mapping(geom),
                    "properties": {
                        "objectid": a["OBJECTID"],
                        "village": a["KGISVillageCode"],
                        "survey": a["surveynumberi"] or 0,
                        "label": (a.get("Label") or "").strip(),
                        "hissa": (a.get("HissaNo") or "").strip(),
                        "surnoc": (a.get("Surnoc") or "").strip(),
                        "category": a.get("Category") or "",
                        "kharab": (a.get("Kharab") or "").strip(),
                        "old_label": (a.get("Surveynumber_Old") or "").strip(),
                        "lgd_village": a.get("LGD_VillageCode"),
                        "ulpin": a.get("ULPIN"),
                        "area_m2": round(a.get("SHAPE.STArea()") or 0.0, 1),
                    },
                }
            )
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, ensure_ascii=False))
    tmp.replace(path)
    return feats


# ── Crop survey rows per survey number ──────────────────────────────────────


class PlotVillage(bc.Village):
    """Keeps the hissa label of every row: [(hissa label, crop, ha)]."""

    @staticmethod
    def report_rows(rows, number):
        seen, out = set(), []
        for _, c in rows:
            if len(c) < 8 or not bc.same_survey(c[4], number):
                continue
            # owner number only de-duplicates repeated rows; it is not kept
            ident = (c[4], c[8] if len(c) > 8 else "", c[9] if len(c) > 9 else "", c[7], c[6])
            if ident in seen:
                continue
            seen.add(ident)
            ha = bc.parse_extent(c[6])
            if ha:
                out.append((c[4], bc.crop_name(c[7]), round(ha, 4)))
        return out


def season_rows(season: str, v: dict, numbers: list[int]) -> dict:
    path = OUT / season / f"{v['code']}.json"
    if path.exists():
        return json.loads(path.read_text())
    site = PlotVillage(season, v["code"], v["name"], "report")
    result: dict = {"code": v["code"], "season": season, "surveys": len(numbers), "answered": 0, "rows": {}}
    if not site.open():
        result["status"] = "not on site"
    else:
        result["status"] = "done"
        result["siteName"] = site.site_name
        for n in numbers:
            rows = site.survey(n)
            if rows is None:
                continue
            result["answered"] += 1
            result["rows"][str(n)] = [list(r) for r in rows]
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(result, ensure_ascii=False))
    tmp.replace(path)
    return result


def village_job(v: dict, seasons: list[str]) -> dict:
    t0 = time.time()
    feats = parcels(v["code"])
    numbers = sorted({f["properties"]["survey"] for f in feats if f["properties"]["survey"] > 0})
    out = {"parcels": len(feats), "surveys": len(numbers), "seasons": {}}
    for s in seasons:
        r = season_rows(s, v, numbers)
        ha = sum(row[2] for rows in r["rows"].values() for row in rows)
        out["seasons"][s] = (r["status"], r["answered"], ha)
    out["secs"] = time.time() - t0
    return out


def fmt_dur(s: float) -> str:
    s = int(s)
    return f"{s // 3600}h{s % 3600 // 60:02d}m" if s >= 3600 else f"{s // 60}m{s % 60:02d}s"


def done_already(v: dict, seasons: list[str]) -> bool:
    return (OUT / "parcels" / f"{v['code']}.geojson").exists() and all(
        (OUT / s / f"{v['code']}.json").exists() for s in seasons
    )


def scrape(seasons: list[str], limit: int | None) -> None:
    vs = bc.villages()[: limit or None]
    todo = [v for v in vs if not done_already(v, seasons)]
    kinds = {"_Rabi": "Rabi ", "_Summer": "Summer "}
    labels = {s: kinds.get(s[4:], "Kharif ") + s[:4] for s in seasons}
    print(f"Raichur plot-level crop survey · seasons: {', '.join(labels.values())}", flush=True)
    print(f"{len(vs)} villages · {len(vs) - len(todo)} already done · {len(todo)} to do · {bc.WORKERS} in parallel\n", flush=True)
    t0 = time.time()
    done = failed = parcels_n = 0
    answered = {s: 0 for s in seasons}
    with ThreadPoolExecutor(bc.WORKERS) as pool:
        futs = {pool.submit(village_job, v, seasons): v for v in todo}
        for f in as_completed(futs):
            v = futs[f]
            done += 1
            elapsed = time.time() - t0
            eta = elapsed / done * (len(todo) - done)
            head = f"[{done:>3}/{len(todo)} {done / len(todo):6.1%} · {fmt_dur(elapsed)} elapsed · ETA {fmt_dur(eta)}]"
            try:
                r = f.result()
            except Exception as e:
                failed += 1
                print(f"{head} {v['code']} {v['name']}: FAILED {e}", flush=True)
                continue
            parcels_n += r["parcels"]
            parts = []
            for s, (status, ans, ha) in r["seasons"].items():
                answered[s] += ans
                parts.append(f"{labels[s]} {ans}/{r['surveys']} {ha:,.0f} ha" if status == "done" else f"{labels[s]} {status}")
            print(
                f"{head} {v['code']} {v['name']}: {r['parcels']} parcels, {r['surveys']} survey nos · "
                + " · ".join(parts)
                + f" · {r['secs']:.0f}s",
                flush=True,
            )
    print(
        f"\nFinished in {fmt_dur(time.time() - t0)}: {done - failed} villages, {failed} failed (rerun to retry), "
        f"{parcels_n:,} parcels · " + ", ".join(f"{labels[s]} {n:,} survey nos answered" for s, n in answered.items()),
        flush=True,
    )


# ── Export ──────────────────────────────────────────────────────────────────


def plot_key(label: str) -> str:
    """Common form of KGIS ("330/1") and crop survey ("330/*/1", "11//1/*") hissa labels."""
    return "/".join(p for p in label.upper().split("/") if p.strip() not in ("", "*"))


def export(seasons: list[str]) -> None:
    import geopandas as gpd
    import pandas as pd

    vs = {v["code"]: v["name"] for v in bc.villages()}
    feats, rows = [], []
    for code, name in vs.items():
        p = OUT / "parcels" / f"{code}.geojson"
        if not p.exists():
            continue
        for f in json.loads(p.read_text())["features"]:
            f["properties"]["village_name"] = name
            feats.append(f)
        for s in seasons:
            sp = OUT / s / f"{code}.json"
            if not sp.exists():
                continue
            for survey, srows in json.loads(sp.read_text())["rows"].items():
                for label, crop, ha in srows:
                    rows.append(
                        {"village": code, "village_name": name, "survey": int(survey), "label": label,
                         "season": s, "crop_kn": crop, "crop_en": bc.crop_en(crop), "ha": ha}
                    )
    if not feats:
        sys.exit("No parcels yet.")
    gdf = gpd.GeoDataFrame.from_features(feats, crs="EPSG:4326")
    crops = pd.DataFrame(rows)
    print(f"{len(gdf):,} parcels in {gdf['village'].nunique()} villages · {len(crops):,} crop rows")

    def crop_columns(df: pd.DataFrame, keys: list[str]) -> pd.DataFrame:
        """Per key and season: main crop, its ha, total ha and every crop as text."""
        out = []
        for s in seasons:
            sub = df[df["season"] == s].groupby(keys + ["crop_en"], as_index=False)["ha"].sum()
            if sub.empty:
                continue
            sub = sub.sort_values("ha", ascending=False)
            tag = ("rabi_" if s.endswith("_Rabi") else "kharif_") + s[:4]
            g = sub.groupby(keys)
            agg = pd.DataFrame(
                {
                    f"{tag}_main": g["crop_en"].first(),
                    f"{tag}_main_ha": g["ha"].first().round(3),
                    f"{tag}_total_ha": g["ha"].sum().round(3),
                    f"{tag}_crops": g.apply(lambda d: "; ".join(f"{c} {h:.2f}" for c, h in zip(d["crop_en"], d["ha"])), include_groups=False),
                }
            )
            out.append(agg)
        return pd.concat(out, axis=1).reset_index() if out else pd.DataFrame(columns=keys)

    gdf["key"] = gdf["label"].map(plot_key)
    if len(crops):
        crops["key"] = crops["label"].map(plot_key)
    per_parcel = crop_columns(crops, ["village", "key"]) if len(crops) else pd.DataFrame(columns=["village", "key"])
    per_survey = crop_columns(crops, ["village", "survey"]) if len(crops) else pd.DataFrame(columns=["village", "survey"])

    # A parcel gets its hissa's crops; a survey number mapped as a single parcel gets the whole survey's.
    parcels_out = gdf.merge(per_parcel, on=["village", "key"], how="left")
    parcels_out["crops_from"] = parcels_out.filter(like="_main").notna().any(axis=1).map({True: "hissa", False: ""})
    single = parcels_out["survey"].gt(0) & parcels_out.groupby(["village", "survey"])["objectid"].transform("count").eq(1)
    fill = single & parcels_out["crops_from"].eq("")
    by_survey = parcels_out.loc[fill, ["village", "survey"]].merge(per_survey, on=["village", "survey"], how="left")
    for col in per_survey.columns.drop(["village", "survey"]):
        parcels_out.loc[fill, col] = by_survey[col].to_numpy()
    parcels_out.loc[fill & parcels_out.filter(like="_main").notna().any(axis=1), "crops_from"] = "survey"
    parcels_out = parcels_out.drop(columns="key")

    numbered = gdf[gdf["survey"] > 0]
    surveys = numbered.dissolve(by=["village", "survey"], aggfunc={"village_name": "first", "area_m2": "sum", "objectid": "count"})
    surveys = surveys.rename(columns={"objectid": "parcels"}).reset_index()
    surveys["area_ha"] = (surveys["area_m2"] / 1e4).round(3)
    surveys = surveys.merge(per_survey, on=["village", "survey"], how="left")

    path = OUT / "Raichur_plots.gpkg"
    if path.exists():
        path.unlink()
    parcels_out.to_file(path, layer="parcels", driver="GPKG")
    surveys.to_file(path, layer="survey_numbers", driver="GPKG")
    if len(crops):
        crops = crops.drop(columns="key")
        gpd.GeoDataFrame(crops, geometry=gpd.GeoSeries([None] * len(crops), crs="EPSG:4326")).to_file(
            path, layer="crop_rows", driver="GPKG"
        )
    src = parcels_out["crops_from"].value_counts()
    print(
        f"{len(surveys):,} survey numbers · parcels with crops: {src.get('hissa', 0):,} by hissa, "
        f"{src.get('survey', 0):,} by whole survey number, {src.get('', 0):,} without"
    )
    print(f"wrote {path} ({path.stat().st_size / 1e6:.0f} MB)")


# ── Publish map files ───────────────────────────────────────────────────────


def _round(coords, places: int = 6):
    if isinstance(coords[0], (int, float)):
        return [round(c, places) for c in coords]
    return [_round(c, places) for c in coords]


def village_file(v: dict, seasons: list[str]) -> dict | None:
    """Parcels of one village with crops per season, by survey number and by hissa."""
    path = OUT / "parcels" / f"{v['code']}.geojson"
    if not path.exists():
        return None
    crops: list[str] = []
    crop_idx: dict[str, int] = {}

    def idx(kn: str) -> int:
        en = bc.crop_en(kn)
        if en not in crop_idx:
            crop_idx[en] = len(crops)
            crops.append(en)
        return crop_idx[en]

    surveys: dict[str, dict[str, dict[int, float]]] = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
    hissas: dict[str, dict[str, dict[int, float]]] = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
    present = []
    for s in seasons:
        sp = OUT / s / f"{v['code']}.json"
        if not sp.exists():
            continue
        present.append(s)
        for survey, rows in json.loads(sp.read_text())["rows"].items():
            for label, crop, ha in rows:
                i = idx(crop)
                surveys[survey][s][i] += ha
                key = plot_key(label)
                if key != survey:
                    hissas[key][s][i] += ha

    def pairs(m: dict[str, dict[int, float]]) -> dict[str, list]:
        return {s: [[i, round(a, 3)] for i, a in sorted(c.items(), key=lambda kv: -kv[1])] for s, c in m.items()}

    feats = []
    for f in json.loads(path.read_text())["features"]:
        p = f["properties"]
        geom = shape(f["geometry"]).simplify(SIMPLIFY_DEG, preserve_topology=True)
        if geom.is_empty:
            continue
        g = mapping(geom)
        props = {"s": p["survey"], "l": p["label"], "a": round(p["area_m2"] / 1e4, 3)}
        if p["category"] != "Parcel":
            props["c"] = p["category"]
        feats.append({"type": "Feature", "properties": props, "geometry": {"type": g["type"], "coordinates": _round(g["coordinates"])}})
    return {
        "village": v["code"],
        "name": v["name"],
        "seasons": present,
        "crops": crops,
        "surveys": {k: pairs(m) for k, m in surveys.items()},
        "hissas": {k: pairs(m) for k, m in hissas.items()},
        "plots": {"type": "FeatureCollection", "features": feats},
    }


def villages_geojson() -> dict:
    """KGIS village outlines at about 2 m, so they line up with the parcels when zoomed in."""
    names = {v["code"]: v["name"] for v in bc.villages()}
    parts: dict[str, list] = defaultdict(list)
    offset, page = 0, 100
    while True:
        js = bc.kgis(
            4,
            where=f"KGISVillageCode LIKE '{bc.DISTRICT}%'",
            outFields="KGISVillageCode",
            returnGeometry="true",
            outSR="4326",
            maxAllowableOffset="0.00002",
            geometryPrecision="6",
            orderByFields="OBJECTID",
            resultOffset=str(offset),
            resultRecordCount=str(page),
        )
        for f in js["features"]:
            geom = esri_geometry(f["geometry"]["rings"]) if f.get("geometry") else None
            if geom is not None:
                parts[f["attributes"]["KGISVillageCode"]].append(geom)
        if len(js["features"]) < page:
            break
        offset += page
    feats = []
    for code, name in names.items():
        polys = [g for p in parts.get(code, []) for g in getattr(p, "geoms", [p])]
        if not polys:
            continue
        geom = polys[0] if len(polys) == 1 else MultiPolygon(polys)
        v = {"code": code, "name": name}
        g = mapping(geom)
        feats.append(
            {"type": "Feature", "properties": {"code": v["code"], "name": v["name"]},
             "geometry": {"type": g["type"], "coordinates": _round(g["coordinates"], 5)}}
        )
    return {"type": "FeatureCollection", "features": feats}


def publish(seasons: list[str], dry_run: bool) -> None:
    import boto3

    s3 = None if dry_run else boto3.client("s3", region_name=os.environ.get("AWS_DEFAULT_REGION", "ap-south-1"))
    if not dry_run and not bc.BUCKET:
        sys.exit("No bucket configured (AWS_S3_BUCKET_NAME).")

    def put(key: str, body: dict, media: str) -> int:
        packed = gzip.compress(json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode(), 9)
        if s3:
            s3.put_object(Bucket=bc.BUCKET, Key=key, Body=packed, ContentType=media, ContentEncoding="gzip")
        return len(packed)

    size = put(VILLAGES_KEY, villages_geojson(), "application/geo+json")
    print(f"village boundaries · {size / 1e6:.2f} MB gzipped → {VILLAGES_KEY}", flush=True)

    vs = bc.villages()
    t0, total, done, plots = time.time(), 0, 0, 0

    def job(v: dict) -> tuple[int, int]:
        body = village_file(v, seasons)
        if body is None:
            return 0, 0
        return put(f"{PLOTS_PREFIX}{v['code']}.json", body, "application/json"), len(body["plots"]["features"])

    with ThreadPoolExecutor(16) as pool:
        for size, n in pool.map(job, vs):
            done += 1
            total += size
            plots += n
            if done % 50 == 0 or done == len(vs):
                print(f"  [{done}/{len(vs)}] {plots:,} parcels · {total / 1e6:.1f} MB gzipped · {fmt_dur(time.time() - t0)}", flush=True)
    where = "(dry run, nothing uploaded)" if dry_run else f"→ s3://{bc.BUCKET}/{PLOTS_PREFIX}"
    print(f"{plots:,} parcels in {done} village files, {total / 1e6:.1f} MB {where}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    sp = sub.add_parser("scrape")
    sp.add_argument("--seasons", nargs="*", default=SEASONS)
    sp.add_argument("--villages", type=int, help="only the first N villages (for a trial run)")
    ep = sub.add_parser("export")
    ep.add_argument("--seasons", nargs="*", default=SEASONS)
    pp = sub.add_parser("publish")
    pp.add_argument("--seasons", nargs="*", default=SEASONS)
    pp.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if args.cmd == "scrape":
        scrape(args.seasons, args.villages)
    elif args.cmd == "export":
        export(args.seasons)
    else:
        publish(args.seasons, args.dry_run)


if __name__ == "__main__":
    main()
