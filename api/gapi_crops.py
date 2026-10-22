"""Cached Google ALU crop totals per T-Lab grid cell.

The Field landscape map colours each S2 cell from this snapshot. GET serves a gzip
file from /tmp (filled after a live /agri/region/summary) or from S3 when
TLAB_GAPI_CROPS_KEY is set. PUT stores a snapshot so the next load skips Google.
"""

from __future__ import annotations

import gzip
import os
from pathlib import Path

import boto3
from botocore.exceptions import ClientError
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

router = APIRouter(prefix="/fwa-api/tlab")
CACHE = Path(os.environ.get("GAPI_CROPS_CACHE", "/tmp/tlab-gapi-crops.json.gz"))
BUCKET = os.environ.get("TLAB_LAYERS_BUCKET") or os.environ.get("AWS_S3_BUCKET_NAME")
S3_KEY = os.environ.get("TLAB_GAPI_CROPS_KEY", "Raichur_gapi_crops.json.gz")
MAX_PUT = 80_000_000


def _gzip(raw: bytes) -> bytes:
	if raw[:2] == b"\x1f\x8b":
		return raw
	return gzip.compress(raw, compresslevel=6)


@router.get("/gapi-crops")
def get_gapi_crops():
	if CACHE.exists():
		return Response(
			CACHE.read_bytes(),
			media_type="application/json",
			headers={"Content-Encoding": "gzip", "Cache-Control": "no-cache"},
		)
	if not BUCKET:
		raise HTTPException(status_code=404, detail="No Google ALU crop snapshot yet.")
	try:
		obj = boto3.client("s3", region_name=os.environ.get("AWS_DEFAULT_REGION", "ap-south-1")).get_object(
			Bucket=BUCKET, Key=S3_KEY
		)
		body = obj["Body"].read()
		CACHE.write_bytes(_gzip(body))
		return Response(
			CACHE.read_bytes(),
			media_type="application/json",
			headers={"Content-Encoding": "gzip", "Cache-Control": "no-cache"},
		)
	except ClientError:
		raise HTTPException(status_code=404, detail="No Google ALU crop snapshot yet.") from None


@router.put("/gapi-crops")
async def put_gapi_crops(request: Request):
	raw = await request.body()
	if not raw or len(raw) > MAX_PUT:
		raise HTTPException(status_code=400, detail="Empty or too large snapshot.")
	CACHE.parent.mkdir(parents=True, exist_ok=True)
	CACHE.write_bytes(_gzip(raw))
	return {"ok": True, "bytes": CACHE.stat().st_size}
