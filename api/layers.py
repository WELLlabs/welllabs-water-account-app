"""T-Lab layers (district boundary, canal network, water need per cell, soil moisture) read from the project S3 bucket.

Object keys come from TLAB_BOUNDARY_KEY, TLAB_CANALS_KEY, TLAB_WATER_KEY, TLAB_SM_KEY and
TLAB_SM_PREFIX (soil moisture frames) in the environment.

Sources stay in the bucket in their native CRS; each request gets a WGS84 GeoJSON
conversion held in memory and revalidated against the object's ETag every
TLAB_LAYER_TTL seconds, so replacing a file in the bucket shows up without a deploy.
"""

from __future__ import annotations

import datetime
import io
import json
import logging
import os
import threading
import time
from pathlib import Path
from typing import Callable, Optional

import boto3
import geopandas as gpd
import pandas as pd
from botocore.exceptions import BotoCoreError, ClientError
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from shapely.geometry import mapping

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

BUCKET = os.environ.get("TLAB_LAYERS_BUCKET") or os.environ.get("AWS_S3_BUCKET_NAME")
TTL_SECONDS = int(os.environ.get("TLAB_LAYER_TTL", "300"))
# Source files without a CRS (e.g. GeoJSON with the legacy "crs" member stripped) are UTM 43N
DEFAULT_CRS = 32643

log = logging.getLogger(__name__)

router = APIRouter(prefix="/fwa-api/tlab/layers")


def _round(obj, places: int):
    if isinstance(obj, (list, tuple)):
        if obj and isinstance(obj[0], (int, float)):
            return [round(v, places) for v in obj]
        return [_round(v, places) for v in obj]
    return obj


def _read(raw: bytes) -> gpd.GeoDataFrame:
    gdf = gpd.read_file(io.BytesIO(raw))
    return gdf if gdf.crs is not None else gdf.set_crs(DEFAULT_CRS)


def _boundary(raw: bytes) -> dict:
    gdf = _read(raw).to_crs(4326)
    union = gdf.geometry.union_all() if hasattr(gdf.geometry, "union_all") else gdf.geometry.unary_union
    geom = mapping(union.simplify(0.0003, preserve_topology=True))
    geom = {"type": geom["type"], "coordinates": _round(geom["coordinates"], 5)}
    return {
        "type": "FeatureCollection",
        "features": [{"type": "Feature", "properties": {"name": "Raichur"}, "geometry": geom}],
    }


CANAL_FIELDS = ("canname", "prjname", "prjcode", "cancode", "can_type", "Label")


def _canals(raw: bytes) -> dict:
    gdf = _read(raw)
    if gdf.crs.is_geographic:
        gdf = gdf.to_crs(DEFAULT_CRS)
    lengths = gdf.geometry.length.round().astype("Int64")
    simplified = gdf.geometry.simplify(3).to_crs(4326)

    features = []
    for i, geom in enumerate(simplified):
        if geom is None or geom.is_empty:
            continue
        row = gdf.iloc[i]
        props = {}
        for field in CANAL_FIELDS:
            value = row.get(field)
            props[field] = None if pd.isna(value) else (int(value) if field == "can_type" else value)
        props["length_m"] = None if pd.isna(lengths.iloc[i]) else int(lengths.iloc[i])
        g = mapping(geom)
        features.append(
            {"type": "Feature", "properties": props, "geometry": {"type": g["type"], "coordinates": _round(g["coordinates"], 6)}}
        )
    return {"type": "FeatureCollection", "features": features}


def _geojson(convert: Callable[[bytes], dict]) -> Callable[[bytes], bytes]:
    return lambda raw: json.dumps(convert(raw), separators=(",", ":")).encode()


class _Layer:
    def __init__(
        self,
        key_env: str,
        convert: Callable[[bytes], bytes],
        media_type: str = "application/geo+json",
        encoding: Optional[str] = None,
        default_key: Optional[str] = None,
    ):
        self.key_env = key_env
        self.key = os.environ.get(key_env, default_key)
        self.convert = convert
        self.media_type = media_type
        self.encoding = encoding
        self.lock = threading.Lock()
        self.etag: Optional[str] = None
        self.body: Optional[bytes] = None
        self.checked = 0.0

    def get(self) -> tuple[bytes, str]:
        if not self.key:
            raise HTTPException(status_code=503, detail=f"Layer file not configured (set {self.key_env}).")
        with self.lock:
            if self.body is not None and time.monotonic() - self.checked < TTL_SECONDS:
                return self.body, self.etag or ""
            s3 = _s3()
            try:
                if self.body is not None:
                    head = s3.head_object(Bucket=BUCKET, Key=self.key)
                    if head["ETag"] == self.etag:
                        self.checked = time.monotonic()
                        return self.body, self.etag
                obj = s3.get_object(Bucket=BUCKET, Key=self.key)
                raw = obj["Body"].read()
            except (ClientError, BotoCoreError) as e:
                if self.body is not None:
                    log.warning("Serving cached %s; could not revalidate s3://%s/%s: %s", self.key_env, BUCKET, self.key, e)
                    return self.body, self.etag or ""
                raise HTTPException(status_code=502, detail=f"Could not read s3://{BUCKET}/{self.key}: {e}") from e
            try:
                self.body = self.convert(raw)
            except Exception as e:
                raise HTTPException(status_code=502, detail=f"Could not convert {self.key}: {e}") from e
            self.etag = obj["ETag"]
            self.checked = time.monotonic()
            return self.body, self.etag


_client = None


def _s3():
    global _client
    if not BUCKET:
        raise HTTPException(status_code=503, detail="No layer bucket configured (set AWS_S3_BUCKET_NAME).")
    if _client is None:
        _client = boto3.client("s3", region_name=os.environ.get("AWS_DEFAULT_REGION", "ap-south-1"))
    return _client


LAYERS = {
    "boundary": _Layer("TLAB_BOUNDARY_KEY", _geojson(_boundary)),
    "canals": _Layer("TLAB_CANALS_KEY", _geojson(_canals)),
    # Per-cell water need per season written by scripts/build_tlab_water.py, already gzipped JSON
    "water": _Layer("TLAB_WATER_KEY", lambda raw: raw, "application/json", "gzip"),
    # Sentinel-1 surface soil moisture written by scripts/build_tlab_sm.py
    "sm": _Layer("TLAB_SM_KEY", lambda raw: raw, "application/json", "gzip", "Raichur_soil_moisture.json.gz"),
}

SM_PREFIX = os.environ.get("TLAB_SM_PREFIX", "Raichur_soil_moisture/")
SM_FRAME_CACHE = 64
_sm_frames: dict[str, _Layer] = {}
_sm_lock = threading.Lock()


def _sm_frame(date: str) -> _Layer:
    with _sm_lock:
        entry = _sm_frames.pop(date, None)
        if entry is None:
            entry = _Layer("TLAB_SM_PREFIX", lambda raw: raw, "image/png")
            entry.key = f"{SM_PREFIX}{date}.png"
        _sm_frames[date] = entry
        while len(_sm_frames) > SM_FRAME_CACHE:
            _sm_frames.pop(next(iter(_sm_frames)))
        return entry


@router.get("/sm/{date}.png")
def sm_frame(date: str, request: Request):
    try:
        datetime.date.fromisoformat(date)
    except ValueError:
        raise HTTPException(status_code=404, detail="Unknown date") from None
    return _respond(_sm_frame(date), request)


@router.get("/{name}")
def layer(name: str, request: Request):
    entry = LAYERS.get(name)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"Unknown layer {name!r}")
    return _respond(entry, request)


def _respond(entry: _Layer, request: Request) -> Response:
    body, etag = entry.get()
    headers = {"Cache-Control": f"public, max-age={TTL_SECONDS}", "ETag": etag}
    if etag and request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    if entry.encoding:
        headers["Content-Encoding"] = entry.encoding
        headers["Vary"] = "Accept-Encoding"
    return Response(content=body, media_type=entry.media_type, headers=headers)
