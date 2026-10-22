"""Upload the Raichur FRUITS scrape (raichur_raw) to S3 for the T-Lab map.

The year CSVs in data-scraping/raichur_raw include owner names. Those columns are never
uploaded. This publishes the already-indexed map files (district snapshot + one gzipped
JSON per village) built by api/raw_crops.py.

    api/.venv/bin/python scripts/publish_tlab_raw_crops.py [--dry-run]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import boto3
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

BUCKET = os.environ.get("TLAB_LAYERS_BUCKET") or os.environ.get("AWS_S3_BUCKET_NAME")
PREFIX = os.environ.get("TLAB_RAW_CROPS_PREFIX", "Raichur_raw_crops/")
CACHE = ROOT / ".cache" / "tlab_raw_crops"
READY = CACHE / "_ready.json"
SNAPSHOT = CACHE / "_snapshot.json.gz"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if not READY.exists() or not SNAPSHOT.exists():
        sys.exit(f"No indexed raichur_raw cache at {CACHE} — load T-Lab once so it can build it.")
    meta = json.loads(READY.read_text())
    villages = sorted(p for p in CACHE.glob("*.json.gz") if p.name != "_snapshot.json.gz")
    if not args.dry_run and not BUCKET:
        sys.exit("No bucket configured (AWS_S3_BUCKET_NAME).")
    s3 = None if args.dry_run else boto3.client("s3", region_name=os.environ.get("AWS_DEFAULT_REGION", "ap-south-1"))

    def put(path: Path) -> int:
        key = f"{PREFIX}{path.name}"
        extra: dict = {"ContentType": "application/json"}
        if path.suffix == ".gz":
            extra["ContentEncoding"] = "gzip"
        body = path.read_bytes()
        if s3:
            s3.put_object(Bucket=BUCKET, Key=key, Body=body, **extra)
        return len(body)

    t0 = time.time()
    ready_n = put(READY)
    snap_n = put(SNAPSHOT)
    print(
        f"_ready.json {ready_n:,} B · snapshot {snap_n / 1e6:.2f} MB · "
        f"{meta.get('villages')} villages · {meta.get('rows'):,} rows",
        flush=True,
    )
    total = ready_n + snap_n
    done = 0
    with ThreadPoolExecutor(16) as pool:
        futs = [pool.submit(put, p) for p in villages]
        for fut in as_completed(futs):
            total += fut.result()
            done += 1
            if done % 100 == 0 or done == len(villages):
                print(f"  [{done}/{len(villages)}] {total / 1e6:.1f} MB · {time.time() - t0:.1f}s", flush=True)
    where = "(dry run, nothing uploaded)" if args.dry_run else f"→ s3://{BUCKET}/{PREFIX}"
    print(f"{done} village files, {total / 1e6:.1f} MB {where}")


if __name__ == "__main__":
    main()
