"""Snapshot the Raichur water need per grid cell and season to S3 for the T-Lab map.

Streams /fwa-api/agri/region/summary for the T-Lab boundary through a running API
(one Google request per S2 cell, ~5,600 in all), retries failed cells, and turns the
crop detections into water need with scripts/tlab_water_totals.mjs. Only the per-cell,
per-season m³ (plus district totals, peak month and plot count per season) is uploaded as TLAB_WATER_KEY;
Google's crop and plot data stays in memory and is discarded.

    api/.venv/bin/python scripts/build_tlab_water.py [--api http://127.0.0.1:8010]
"""

from __future__ import annotations

import argparse
import datetime
import gzip
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import boto3
import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

BUCKET = os.environ.get("TLAB_LAYERS_BUCKET") or os.environ.get("AWS_S3_BUCKET_NAME")
KEY = os.environ.get("TLAB_WATER_KEY")
GAPI_KEY = os.environ.get("TLAB_GAPI_CROPS_KEY", "Raichur_gapi_crops.json.gz")
RETRY_ROUNDS = 3


def stream_summary(api: str, boundary: dict, cells: list[str] | None, out: dict[str, dict]) -> list[str]:
    """Collect cell summaries into `out`; returns the ids of cells that failed."""
    body: dict = {"geometry": boundary}
    if cells is not None:
        body["cells"] = cells
    failed: list[str] = []
    total = 0
    started = time.monotonic()
    with httpx.stream("POST", f"{api}/fwa-api/agri/region/summary", json=body, timeout=None) as res:
        res.raise_for_status()
        for line in res.iter_lines():
            if not line.strip():
                continue
            msg = json.loads(line)
            if msg["type"] == "start":
                total = msg["cells"]
            elif msg["type"] == "cell":
                if msg.get("error"):
                    failed.append(msg["cellId"])
                elif msg.get("ring"):
                    out[msg["cellId"]] = {
                        "id": msg["cellId"],
                        "ring": msg["ring"],
                        "plots": msg.get("plots", 0),
                        "area": msg.get("area", 0),
                        "rows": msg.get("rows", []),
                    }
                done = msg["done"]
                if done % 250 == 0 or done == total:
                    rate = done / max(1e-6, time.monotonic() - started)
                    print(f"  {done}/{total} cells · {len(failed)} failed · {rate:.0f} cells/s", flush=True)
    return failed


def gapi_crops(cells: dict[str, dict]) -> dict:
    """Prominent-crop snapshot: cell → season → [English crop, ha] from region/summary rows."""
    out = []
    for cell in cells.values():
        by_season: dict[str, dict[str, float]] = {}
        for row in cell.get("rows") or []:
            key, _month, code, _band, _plots, area = row
            if not code or code in ("NO_PREDICTION", "UNKNOWN_CROP"):
                continue
            name = " ".join(p.capitalize() for p in str(code).lower().split("_"))
            season = by_season.setdefault(key, {})
            season[name] = season.get(name, 0.0) + (area or 0) / 10_000
        if not by_season:
            continue
        out.append(
            {
                "id": cell["id"],
                "seasons": {
                    key: [[crop, round(ha, 1)] for crop, ha in sorted(sums.items(), key=lambda kv: -kv[1])]
                    for key, sums in by_season.items()
                },
            }
        )
    return {
        "version": 1,
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "cells": out,
    }


def water_totals(cells: list[dict]) -> dict:
    res = subprocess.run(
        ["node", str(ROOT / "scripts" / "tlab_water_totals.mjs")],
        input=json.dumps(cells, separators=(",", ":")).encode(),
        capture_output=True,
        cwd=ROOT,
    )
    if res.returncode != 0:
        sys.exit(f"Water calculation failed:\n{res.stderr.decode()[-2000:]}")
    return json.loads(res.stdout)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--api", default="http://127.0.0.1:8010")
    args = parser.parse_args()
    if not BUCKET:
        sys.exit("Set AWS_S3_BUCKET_NAME (or TLAB_LAYERS_BUCKET).")
    if not KEY:
        sys.exit("Set TLAB_WATER_KEY (the object name to write in the bucket).")

    boundary = httpx.get(f"{args.api}/fwa-api/tlab/layers/boundary", timeout=60).raise_for_status().json()

    cells: dict[str, dict] = {}
    print("Fetching district summary…", flush=True)
    failed = stream_summary(args.api, boundary, None, cells)
    for round_no in range(1, RETRY_ROUNDS + 1):
        if not failed:
            break
        print(f"Retrying {len(failed)} failed cells (round {round_no})…", flush=True)
        time.sleep(10 * round_no)
        failed = stream_summary(args.api, boundary, failed, cells)

    print("Calculating water need per season…", flush=True)
    crops = gapi_crops(cells)
    totals = water_totals(list(cells.values()))
    cells.clear()
    payload = {
        "version": 4,
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "region": "Raichur",
        "failed": failed,
        **totals,
    }
    s3 = boto3.client("s3", region_name=os.environ.get("AWS_DEFAULT_REGION", "ap-south-1"))
    raw = json.dumps(payload, separators=(",", ":")).encode()
    packed = gzip.compress(raw, compresslevel=9)
    s3.put_object(
        Bucket=BUCKET,
        Key=KEY,
        Body=packed,
        ContentType="application/json",
        ContentEncoding="gzip",
    )
    print(
        f"Uploaded s3://{BUCKET}/{KEY}: {len(totals['cells'])} cells × {len(totals['seasons'])} seasons, "
        f"{len(failed)} cells failed, {len(packed) / 1e3:.0f} kB gzipped"
    )
    gapi_raw = json.dumps(crops, separators=(",", ":")).encode()
    gapi_packed = gzip.compress(gapi_raw, compresslevel=9)
    s3.put_object(
        Bucket=BUCKET,
        Key=GAPI_KEY,
        Body=gapi_packed,
        ContentType="application/json",
        ContentEncoding="gzip",
    )
    print(
        f"Uploaded s3://{BUCKET}/{GAPI_KEY}: {len(crops['cells'])} cells, {len(gapi_packed) / 1e3:.0f} kB gzipped"
    )


if __name__ == "__main__":
    main()
