"""Cached Google ALU crop totals per T-Lab grid cell.

The Field landscape map colours each S2 cell from this snapshot. GET serves the
S3 object (revalidated on the same TTL as other T-Lab layers) and falls back to
/tmp when S3 is missing. PUT keeps a local copy so a live /agri/region/summary
can skip Google on the next load of this process; it does not write S3.
"""

from __future__ import annotations

import gzip
import logging
import os
import threading
import time
from pathlib import Path

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

router = APIRouter(prefix="/fwa-api/tlab")
CACHE = Path(os.environ.get("GAPI_CROPS_CACHE", "/tmp/tlab-gapi-crops.json.gz"))
BUCKET = os.environ.get("TLAB_LAYERS_BUCKET") or os.environ.get("AWS_S3_BUCKET_NAME")
S3_KEY = os.environ.get("TLAB_GAPI_CROPS_KEY", "Raichur_gapi_crops.json.gz")
TTL_SECONDS = int(os.environ.get("TLAB_LAYER_TTL", "300"))
MAX_PUT = 80_000_000
HEADERS = {"Content-Encoding": "gzip", "Cache-Control": "no-cache"}

log = logging.getLogger(__name__)
_lock = threading.Lock()
_etag: str | None = None
_body: bytes | None = None
_checked = 0.0


def _gzip(raw: bytes) -> bytes:
	if raw[:2] == b"\x1f\x8b":
		return raw
	return gzip.compress(raw, compresslevel=6)


def _s3():
	return boto3.client("s3", region_name=os.environ.get("AWS_DEFAULT_REGION", "ap-south-1"))


def _serve(body: bytes) -> Response:
	return Response(body, media_type="application/json", headers=HEADERS)


@router.get("/gapi-crops")
def get_gapi_crops():
	global _etag, _body, _checked
	if BUCKET:
		with _lock:
			now = time.monotonic()
			if _body is not None and now - _checked < TTL_SECONDS:
				return _serve(_body)
			s3 = _s3()
			try:
				if _body is not None:
					head = s3.head_object(Bucket=BUCKET, Key=S3_KEY)
					if head["ETag"] == _etag:
						_checked = now
						return _serve(_body)
				obj = s3.get_object(Bucket=BUCKET, Key=S3_KEY)
				body = _gzip(obj["Body"].read())
			except (ClientError, BotoCoreError) as e:
				if _body is not None:
					log.warning("Serving cached gapi-crops; could not revalidate s3://%s/%s: %s", BUCKET, S3_KEY, e)
					return _serve(_body)
			else:
				_body = body
				_etag = obj["ETag"]
				_checked = now
				try:
					CACHE.parent.mkdir(parents=True, exist_ok=True)
					CACHE.write_bytes(body)
				except OSError as e:
					log.warning("Could not write gapi-crops cache %s: %s", CACHE, e)
				return _serve(body)
	if CACHE.exists():
		return _serve(CACHE.read_bytes())
	raise HTTPException(status_code=404, detail="No Google ALU crop snapshot yet.")


@router.put("/gapi-crops")
async def put_gapi_crops(request: Request):
	raw = await request.body()
	if not raw or len(raw) > MAX_PUT:
		raise HTTPException(status_code=400, detail="Empty or too large snapshot.")
	body = _gzip(raw)
	CACHE.parent.mkdir(parents=True, exist_ok=True)
	CACHE.write_bytes(body)
	return {"ok": True, "bytes": CACHE.stat().st_size}
