"""Stream Google ALU crop summaries for the NLBC command area.

    api/.venv/bin/python -u scripts/nlbc_gapi_crops.py
"""

from __future__ import annotations

import gzip
import json
import time
from pathlib import Path

import geopandas as gpd
import httpx
from shapely.geometry import mapping

ROOT = Path(__file__).resolve().parent.parent
GPKG = ROOT / "data-scraping" / "NLBC" / "NLBC_Branch_Command.gpkg"
OUT = ROOT / ".cache" / "nlbc_gapi.json.gz"
API = "http://127.0.0.1:8010"
RETRY_ROUNDS = 3


def boundary() -> dict:
    gdf = gpd.read_file(GPKG).to_crs(4326)
    feats = []
    for _, row in gdf.iterrows():
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue
        feats.append(
            {
                "type": "Feature",
                "properties": {
                    "name": row.get("Admin_Name"),
                    "project": row.get("Project"),
                    "area_ha": row.get("Area_ha"),
                },
                "geometry": mapping(geom),
            }
        )
    return {"type": "FeatureCollection", "features": feats}


def stream(fc: dict, cells: list[str] | None, out: dict[str, dict]) -> list[str]:
    body: dict = {"geometry": fc}
    if cells is not None:
        body["cells"] = cells
    failed: list[str] = []
    total = 0
    started = time.monotonic()
    with httpx.stream("POST", f"{API}/fwa-api/agri/region/summary", json=body, timeout=None) as res:
        res.raise_for_status()
        for line in res.iter_lines():
            if not line.strip():
                continue
            msg = json.loads(line)
            if msg["type"] == "start":
                total = msg["cells"]
                print(f"  start {total} cells, {msg.get('areaKm2')} km²", flush=True)
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
                if done % 100 == 0 or done == total:
                    rate = done / max(1e-6, time.monotonic() - started)
                    print(f"  {done}/{total} · {len(out)} ok · {len(failed)} fail · {rate:.1f}/s", flush=True)
                    save(out)
    return failed


def save(cells: dict[str, dict]) -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": 1,
        "source": "Google Agricultural Understanding API",
        "boundary": "NLBC_Branch_Command.gpkg",
        "cells": list(cells.values()),
    }
    OUT.write_bytes(gzip.compress(json.dumps(payload, separators=(",", ":")).encode(), 6))


def main() -> None:
    fc = boundary()
    print("Planning…", flush=True)
    plan = httpx.post(f"{API}/fwa-api/agri/region/plan", json={"geometry": fc}, timeout=120).raise_for_status().json()
    print(
        f"  {plan['cells']} cells · {plan['areaKm2']} km² · mode {plan['mode']} · ~{plan['estimatedSeconds']}s",
        flush=True,
    )
    cells: dict[str, dict] = {}
    if OUT.exists():
        snap = json.loads(gzip.decompress(OUT.read_bytes()))
        cells = {c["id"]: c for c in snap.get("cells") or []}
        print(f"  resumed {len(cells)} cached cells", flush=True)
    failed = stream(fc, None, cells)
    for n in range(1, RETRY_ROUNDS + 1):
        if not failed:
            break
        print(f"Retry {n}: {len(failed)} cells", flush=True)
        time.sleep(8 * n)
        failed = stream(fc, failed, cells)
    save(cells)
    print(f"Wrote {OUT} · {len(cells)} cells · {len(failed)} still failed", flush=True)


if __name__ == "__main__":
    main()
