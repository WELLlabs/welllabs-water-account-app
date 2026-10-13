"""Build the T-Lab surface soil moisture layer from Sentinel-1 radar and upload it to S3.

Sentinel-1 RTC (radiometrically terrain corrected) VV backscatter comes from Microsoft
Planetary Computer, which needs no account. Every pass over the T-Lab boundary is
averaged onto a 250 m UTM grid and turned into relative surface soil moisture
(0-100 % of the wettest state) by change detection, the TU Wien method behind the
Copernicus Sentinel-1 soil moisture products:

    ssm = (σ0 - σ0_dry) / (σ0_wet - σ0_dry)

with σ0_dry and σ0_wet the 5th and 95th percentile of each pixel's backscatter over
the whole record, per satellite track (the two tracks see the ground at different angles).
Pixels whose backscatter barely changes (towns, rock, open water) are left blank.

Uploads TLAB_SM_KEY (gzipped JSON: dates, per-cell values) and one PNG per date under
TLAB_SM_PREFIX (8-bit grey, 0 = no data, 1..101 = 0..100 %, latest pass per pixel
within MAX_AGE_DAYS). Nothing is written locally.

    api/.venv/bin/python scripts/build_tlab_sm.py [--api http://127.0.0.1:8010] [--start 2020-01-01]

Needs rasterio and pillow in that environment (pip install rasterio pillow).
"""

from __future__ import annotations

import argparse
import base64
import datetime
import gzip
import io
import json
import math
import os
import sys
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import boto3
import httpx
import numpy as np
import rasterio
import s2sphere
from dotenv import load_dotenv
from affine import Affine
from PIL import Image
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.features import geometry_mask
from rasterio.transform import from_origin
from rasterio.warp import reproject, transform_bounds
from rasterio.windows import Window
from shapely.geometry import mapping, shape
from shapely.ops import transform as shp_transform
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

BUCKET = os.environ.get("TLAB_LAYERS_BUCKET") or os.environ.get("AWS_S3_BUCKET_NAME")
KEY = os.environ.get("TLAB_SM_KEY", "Raichur_soil_moisture.json.gz")
PREFIX = os.environ.get("TLAB_SM_PREFIX", "Raichur_soil_moisture/")

STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
SAS = "https://planetarycomputer.microsoft.com/api/sas/v1/token/sentinel-1-rtc"
COLLECTION = "sentinel-1-rtc"
UTM = "EPSG:32643"
RES = 250  # metres
SRC_RES = 10
STEP = RES // SRC_RES
IMG_RES = 0.0025  # degrees, ~270 m, for the web overlay
MAX_AGE_DAYS = 12
DRY_PCT, WET_PCT = 5, 95
MIN_OBS = 20  # passes per track before a pixel gets a dry/wet reference
MIN_RANGE_DB = 2.5  # wet - dry; below this backscatter doesn't respond to moisture
MEDIAN_DB = (-20.0, -3.0)  # outside: open water (low) or built-up / rock (high)
MIN_CELL_COVER = 0.5  # share of a cell's pixels a pass must see to report a cell value
CELL_LEVEL = 13
NO_VALUE = 255
WORKERS = 8

for k, v in {
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES": "YES",
    "GDAL_HTTP_MULTIPLEX": "YES",
    "GDAL_HTTP_MAX_RETRY": "5",
    "GDAL_HTTP_RETRY_DELAY": "2",
    "VSI_CACHE": "TRUE",
}.items():
    os.environ.setdefault(k, v)


class SasToken:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.token = ""
        self.expires = 0.0

    def get(self) -> str:
        with self.lock:
            if time.time() > self.expires - 300:
                res = httpx.get(SAS, timeout=60).raise_for_status().json()
                self.token = res["token"]
                exp = datetime.datetime.fromisoformat(res["msft:expiry"].replace("Z", "+00:00"))
                self.expires = exp.timestamp()
            return self.token


def search(bbox: list[float], start: str) -> list[dict]:
    end = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    body: dict | None = {
        "collections": [COLLECTION],
        "bbox": bbox,
        "datetime": f"{start}T00:00:00Z/{end}",
        "limit": 500,
    }
    items: list[dict] = []
    url = STAC
    while True:
        req = httpx.post(url, json=body, timeout=120) if body is not None else httpx.get(url, timeout=120)
        res = req.raise_for_status().json()
        items += [f for f in res["features"] if "vv" in f["assets"]]
        nxt = next((link for link in res.get("links", []) if link.get("rel") == "next"), None)
        if nxt is None:
            return items
        url = nxt["href"]
        body = nxt.get("body") if nxt.get("method", "GET").upper() == "POST" else None


def read_vv(href: str, x0: float, y1: float, gw: int, gh: int) -> np.ndarray | None:
    """Mean linear γ0 VV on the 250 m grid; NaN where the scene has no data.

    Scenes come in whichever UTM zone their centre falls in, so the grid's footprint is
    read from the scene's overviews at ~250 m and then warped onto the grid.
    """
    out = np.full((gh, gw), np.nan, dtype=np.float32)
    with rasterio.open(href) as src:
        left, bottom, right, top = transform_bounds(UTM, src.crs, x0, y1 - gh * RES, x0 + gw * RES, y1)
        col0 = max(0, math.floor((left - src.transform.c) / SRC_RES) - STEP)
        col1 = min(src.width, math.ceil((right - src.transform.c) / SRC_RES) + STEP)
        row0 = max(0, math.floor((src.transform.f - top) / SRC_RES) - STEP)
        row1 = min(src.height, math.ceil((src.transform.f - bottom) / SRC_RES) + STEP)
        if col1 - col0 < STEP or row1 - row0 < STEP:
            return None
        win = Window(col0, row0, col1 - col0, row1 - row0)
        oh, ow = max(1, (row1 - row0) // STEP), max(1, (col1 - col0) // STEP)
        part = src.read(1, window=win, out_shape=(oh, ow), resampling=Resampling.average, masked=True)
        part_tf = src.window_transform(win) * Affine.scale((col1 - col0) / ow, (row1 - row0) / oh)
        src_crs = src.crs
    vals = part.filled(np.nan).astype(np.float32)
    vals[~(vals > 0)] = np.nan
    reproject(
        vals, out, src_transform=part_tf, src_crs=src_crs, dst_transform=from_origin(x0, y1, RES, RES), dst_crs=UTM,
        src_nodata=np.nan, dst_nodata=np.nan, resampling=Resampling.bilinear,
    )
    return out if np.isfinite(out).any() else None


def cell_index(x0: float, y1: float, gw: int, gh: int, inside: np.ndarray) -> tuple[list[str], np.ndarray]:
    """S2 level-13 cell of every pixel centre: (cell ids, per-pixel index into them, -1 outside)."""
    xs = x0 + (np.arange(gw) + 0.5) * RES
    ys = y1 - (np.arange(gh) + 0.5) * RES
    xx, yy = np.meshgrid(xs, ys)
    lng, lat = Transformer.from_crs(UTM, "EPSG:4326", always_xy=True).transform(xx, yy)
    ids: dict[int, int] = {}
    idx = np.full(gw * gh, -1, dtype=np.int32)
    flat_in = inside.ravel()
    for i, (la, ln) in enumerate(zip(lat.ravel(), lng.ravel())):
        if not flat_in[i]:
            continue
        cid = s2sphere.CellId.from_lat_lng(s2sphere.LatLng.from_degrees(la, ln)).parent(CELL_LEVEL).id()
        idx[i] = ids.setdefault(cid, len(ids))
    order = [str(c) for c, _ in sorted(ids.items(), key=lambda kv: kv[1])]
    return order, idx.reshape(gh, gw)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--api", default="http://127.0.0.1:8010")
    parser.add_argument("--start", default="2020-01-01")
    args = parser.parse_args()
    if not BUCKET:
        sys.exit("Set AWS_S3_BUCKET_NAME (or TLAB_LAYERS_BUCKET).")

    fc = httpx.get(f"{args.api}/fwa-api/tlab/layers/boundary", timeout=60).raise_for_status().json()
    boundary = unary_union([shape(f["geometry"]) for f in fc["features"]])
    to_utm = Transformer.from_crs("EPSG:4326", UTM, always_xy=True).transform
    boundary_utm = shp_transform(to_utm, boundary)
    bx0, by0, bx1, by1 = boundary_utm.bounds
    x0, y1 = math.floor(bx0 / RES) * RES, math.ceil(by1 / RES) * RES
    gw, gh = math.ceil((bx1 - x0) / RES), math.ceil((y1 - by0) / RES)
    grid_tf = from_origin(x0, y1, RES, RES)
    inside = ~geometry_mask([mapping(boundary_utm)], out_shape=(gh, gw), transform=grid_tf, all_touched=True)
    print(f"Grid {gw}×{gh} at {RES} m, {inside.sum()} pixels inside the boundary", flush=True)

    items = search(list(boundary.bounds), args.start)
    print(f"{len(items)} Sentinel-1 RTC scenes since {args.start}", flush=True)

    sas = SasToken()
    passes: dict[tuple[str, int], np.ndarray] = {}
    started = time.monotonic()

    def load(item: dict) -> tuple[tuple[str, int], np.ndarray | None]:
        key = (item["properties"]["datetime"][:10], int(item["properties"]["sat:relative_orbit"]))
        href = f"{item['assets']['vv']['href']}?{sas.get()}"
        for attempt in range(4):
            try:
                return key, read_vv(href, x0, y1, gw, gh)
            except Exception as e:  # network hiccups on Planetary Computer
                if attempt == 3:
                    print(f"  skipped {item['id']}: {e}", flush=True)
                    return key, None
                time.sleep(5 * (attempt + 1))
        return key, None

    with ThreadPoolExecutor(WORKERS) as pool:
        futures = [pool.submit(load, it) for it in items]
        for n, fut in enumerate(as_completed(futures), 1):
            key, arr = fut.result()
            if arr is not None:
                prev = passes.get(key)
                passes[key] = arr if prev is None else np.where(np.isnan(prev), arr, prev)
            if n % 50 == 0 or n == len(futures):
                print(f"  {n}/{len(futures)} scenes read · {time.monotonic() - started:.0f} s", flush=True)

    # Change detection per track
    ssm: dict[tuple[str, int], np.ndarray] = {}
    for track in sorted({t for _, t in passes}):
        keys = sorted(k for k in passes if k[1] == track)
        stack = np.stack([passes[k] for k in keys])
        db = 10 * np.log10(stack)
        count = np.isfinite(db).sum(axis=0)
        dry, med, wet = np.nanpercentile(db, [DRY_PCT, 50, WET_PCT], axis=0)
        ok = inside & (count >= MIN_OBS) & (wet - dry >= MIN_RANGE_DB) & (med > MEDIAN_DB[0]) & (med < MEDIAN_DB[1])
        span = np.where(ok, wet - dry, np.nan)
        for i, k in enumerate(keys):
            rel = np.clip((db[i] - dry) / span, 0, 1) * 100
            out = np.full((gh, gw), NO_VALUE, dtype=np.uint8)
            good = ok & np.isfinite(rel)
            out[good] = np.rint(rel[good]).astype(np.uint8)
            ssm[k] = out
        print(f"Track {track}: {len(keys)} passes, {ok.sum()} pixels with a reference", flush=True)
    passes.clear()

    # One frame per date: the tracks never overlap in time, but merge just in case
    by_date: dict[str, np.ndarray] = {}
    tracks: dict[str, list[int]] = defaultdict(list)
    for (date, track), arr in sorted(ssm.items()):
        prev = by_date.get(date)
        by_date[date] = arr if prev is None else np.where(prev == NO_VALUE, arr, prev)
        tracks[date].append(track)
    dates = sorted(d for d, a in by_date.items() if (a != NO_VALUE).any())

    cell_ids, pix_cell = cell_index(x0, y1, gw, gh, inside)
    n_cells = len(cell_ids)
    flat_cell = pix_cell.ravel()
    in_cell = flat_cell >= 0
    cell_pixels = np.bincount(flat_cell[in_cell], minlength=n_cells)
    cell_values = np.full((n_cells, len(dates)), NO_VALUE, dtype=np.uint8)

    # Web overlay grid in WGS84
    w, s, e, n = transform_bounds(UTM, "EPSG:4326", x0, y1 - gh * RES, x0 + gw * RES, y1)
    w, s = math.floor(w / IMG_RES) * IMG_RES, math.floor(s / IMG_RES) * IMG_RES
    e, n = math.ceil(e / IMG_RES) * IMG_RES, math.ceil(n / IMG_RES) * IMG_RES
    iw, ih = round((e - w) / IMG_RES), round((n - s) / IMG_RES)
    img_tf = from_origin(w, n, IMG_RES, IMG_RES)

    s3 = boto3.client("s3", region_name=os.environ.get("AWS_DEFAULT_REGION", "ap-south-1"))
    latest = np.full((gh, gw), NO_VALUE, dtype=np.uint8)
    latest_day = np.full((gh, gw), -10_000, dtype=np.int32)
    date_rows = []
    pngs: list[tuple[str, bytes]] = []
    for j, date in enumerate(dates):
        arr = by_date[date]
        day = datetime.date.fromisoformat(date).toordinal()
        seen = arr != NO_VALUE
        latest[seen] = arr[seen]
        latest_day[seen] = day
        frame = np.where(day - latest_day <= MAX_AGE_DAYS, latest, NO_VALUE).astype(np.uint8)

        flat = arr.ravel()
        valid = in_cell & (flat != NO_VALUE)
        sums = np.bincount(flat_cell[valid], weights=flat[valid].astype(np.float64), minlength=n_cells)
        cnts = np.bincount(flat_cell[valid], minlength=n_cells)
        enough = cnts >= np.maximum(1, MIN_CELL_COVER * cell_pixels)
        cell_values[enough, j] = np.rint(sums[enough] / cnts[enough]).astype(np.uint8)

        img = np.full((ih, iw), NO_VALUE, dtype=np.uint8)
        reproject(
            frame, img, src_transform=grid_tf, src_crs=UTM, dst_transform=img_tf, dst_crs="EPSG:4326",
            src_nodata=NO_VALUE, dst_nodata=NO_VALUE, resampling=Resampling.nearest,
        )
        grey = np.where(img == NO_VALUE, 0, img.astype(np.uint16) + 1).astype(np.uint8)
        buf = io.BytesIO()
        Image.fromarray(grey, mode="L").save(buf, format="PNG", optimize=True)
        pngs.append((date, buf.getvalue()))

        fvals = frame[inside & (frame != NO_VALUE)]
        date_rows.append(
            {
                "date": date,
                "tracks": tracks[date],
                "cover": round(float(seen[inside].mean()), 3),
                "mean": round(float(fvals.mean()), 1) if fvals.size else None,
            }
        )

    payload = {
        "version": 1,
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "region": "Raichur",
        "method": {
            "resolutionM": RES,
            "dryPercentile": DRY_PCT,
            "wetPercentile": WET_PCT,
            "minRangeDb": MIN_RANGE_DB,
            "maxAgeDays": MAX_AGE_DAYS,
            "from": dates[0] if dates else None,
        },
        "image": {
            "bounds": [[round(s, 6), round(w, 6)], [round(n, 6), round(e, 6)]],
            "width": iw,
            "height": ih,
            "encoding": {"nodata": 0, "offset": 1, "scale": 1},
        },
        "dates": date_rows,
        "cells": {
            "ids": cell_ids,
            "noValue": NO_VALUE,
            "values": [base64.b64encode(row.tobytes()).decode() for row in cell_values],
        },
    }
    packed = gzip.compress(json.dumps(payload, separators=(",", ":")).encode(), compresslevel=9)

    print(f"Uploading {len(pngs)} frames…", flush=True)
    keep = set()
    with ThreadPoolExecutor(WORKERS) as pool:
        uploads = []
        for date, body in pngs:
            key = f"{PREFIX}{date}.png"
            keep.add(key)
            uploads.append(pool.submit(s3.put_object, Bucket=BUCKET, Key=key, Body=body, ContentType="image/png"))
        for fut in uploads:
            fut.result()
    stale = []
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=BUCKET, Prefix=PREFIX):
        stale += [o["Key"] for o in page.get("Contents", []) if o["Key"].endswith(".png") and o["Key"] not in keep]
    for i in range(0, len(stale), 1000):
        s3.delete_objects(Bucket=BUCKET, Delete={"Objects": [{"Key": k} for k in stale[i : i + 1000]]})
    s3.put_object(Bucket=BUCKET, Key=KEY, Body=packed, ContentType="application/json", ContentEncoding="gzip")
    print(
        f"Uploaded s3://{BUCKET}/{KEY}: {len(dates)} dates ({dates[0] if dates else '-'} to {dates[-1] if dates else '-'}), "
        f"{n_cells} cells, {len(packed) / 1e3:.0f} kB; frames under {PREFIX} ({sum(len(b) for _, b in pngs) / 1e6:.1f} MB), "
        f"{len(stale)} stale removed"
    )


if __name__ == "__main__":
    main()
