"""FastAPI backend for QGZ generation using geopandas."""

from __future__ import annotations

import gzip
import json
import shutil
import traceback
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from .qgz_builder import build_qgz

# Chunked uploads land here (each chunk stays under nginx's default 1m limit)
UPLOAD_ROOT = Path("/tmp/welllabs-qgz-uploads")
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Farm Water Accounting QGZ API", version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/fwa-api/health")
async def health():
    return {"ok": True, "service": "qgz-api", "version": "1.1.0"}


def _decode_config_bytes(raw: bytes, content_encoding: str | None) -> dict:
    encoding = (content_encoding or "").lower().strip()
    if encoding == "gzip" or (len(raw) >= 2 and raw[0] == 0x1F and raw[1] == 0x8B):
        try:
            raw = gzip.decompress(raw)
        except OSError as e:
            raise HTTPException(status_code=400, detail=f"Invalid gzip body: {e}") from e

    try:
        config_obj = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise HTTPException(status_code=400, detail=f"Invalid config JSON: {e}") from e

    if not isinstance(config_obj, dict):
        raise HTTPException(status_code=400, detail="config must be a JSON object")
    if not config_obj.get("boundaries", {}).get("features"):
        raise HTTPException(status_code=400, detail="boundaries.features is required")
    return config_obj


def _build_response(config_obj: dict) -> Response:
    try:
        qgz_bytes, filename = build_qgz(config_obj, offline_files={})
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"QGZ generation failed: {e}") from e

    return Response(
        content=qgz_bytes,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-QGZ-Filename": filename,
        },
    )


@app.post("/fwa-api/generate-qgz")
async def generate_qgz(request: Request):
    """
    Generate a QGZ project (data.gpkg + .qgs).

    Accepts:
    - application/json (optionally Content-Encoding: gzip)
    - application/gzip or application/octet-stream gzip payload
    - multipart form with a `config` JSON field (legacy)

    Offline basemap files must be merged client-side — do not upload MBTiles.
    """
    content_type = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    content_encoding = request.headers.get("content-encoding")

    if content_type.startswith("multipart/"):
        # Legacy path — keep for older clients; prefer JSON/gzip
        form = await request.form(max_part_size=512 * 1024 * 1024)
        config_raw = form.get("config")
        if config_raw is None:
            raise HTTPException(status_code=400, detail="Missing form field: config")
        if hasattr(config_raw, "read"):
            config_raw = (await config_raw.read()).decode("utf-8")  # type: ignore[union-attr]
        else:
            config_raw = str(config_raw)
        try:
            config_obj = json.loads(config_raw)
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=400, detail=f"Invalid config JSON: {e}") from e
        if not isinstance(config_obj, dict):
            raise HTTPException(status_code=400, detail="config must be a JSON object")
        if not config_obj.get("boundaries", {}).get("features"):
            raise HTTPException(status_code=400, detail="boundaries.features is required")
        return _build_response(config_obj)

    raw = await request.body()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty request body")

    # Treat explicit gzip content-types as gzip even without Content-Encoding
    if content_type in ("application/gzip", "application/x-gzip"):
        content_encoding = "gzip"

    config_obj = _decode_config_bytes(raw, content_encoding)
    return _build_response(config_obj)


@app.post("/fwa-api/generate-qgz/init")
async def generate_qgz_init():
    """Start a chunked upload session (each chunk stays under ~512 KiB)."""
    upload_id = uuid.uuid4().hex
    dest = UPLOAD_ROOT / upload_id
    dest.mkdir(parents=True, exist_ok=False)
    return {"upload_id": upload_id}


@app.put("/fwa-api/generate-qgz/chunk/{upload_id}/{index}")
async def generate_qgz_chunk(upload_id: str, index: int, request: Request):
    """Store one chunk. `index` is 0-based. Body max should stay under 512 KiB."""
    if not upload_id.isalnum() or len(upload_id) > 64:
        raise HTTPException(status_code=400, detail="Invalid upload_id")
    if index < 0 or index > 10_000:
        raise HTTPException(status_code=400, detail="Invalid chunk index")

    dest = UPLOAD_ROOT / upload_id
    if not dest.is_dir():
        raise HTTPException(status_code=404, detail="Unknown upload_id — call /init first")

    raw = await request.body()
    if len(raw) > 400 * 1024:
        raise HTTPException(status_code=413, detail="Chunk too large (max 256 KiB recommended)")

    (dest / f"{index:06d}.part").write_bytes(raw)
    return {"ok": True, "index": index, "bytes": len(raw)}


@app.post("/fwa-api/generate-qgz/complete/{upload_id}")
async def generate_qgz_complete(upload_id: str, request: Request):
    """
    Assemble chunks and build the QGZ.

    JSON body: { "total_chunks": N, "content_encoding": "gzip" | null }
    """
    if not upload_id.isalnum() or len(upload_id) > 64:
        raise HTTPException(status_code=400, detail="Invalid upload_id")

    dest = UPLOAD_ROOT / upload_id
    if not dest.is_dir():
        raise HTTPException(status_code=404, detail="Unknown upload_id")

    try:
        meta = await request.json()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON body: {e}") from e

    total = int(meta.get("total_chunks") or 0)
    if total <= 0:
        raise HTTPException(status_code=400, detail="total_chunks is required")

    parts: list[bytes] = []
    for i in range(total):
        part_path = dest / f"{i:06d}.part"
        if not part_path.is_file():
            raise HTTPException(status_code=400, detail=f"Missing chunk {i}")
        parts.append(part_path.read_bytes())

    raw = b"".join(parts)
    encoding = meta.get("content_encoding")
    try:
        config_obj = _decode_config_bytes(raw, encoding)
        return _build_response(config_obj)
    finally:
        shutil.rmtree(dest, ignore_errors=True)
