"""FastAPI backend for QGZ generation using geopandas."""

from __future__ import annotations

import json
import traceback

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from starlette.formparsers import MultiPartParser

from .qgz_builder import build_qgz

# Allow large form fields (GeoJSON config). Offline basemaps are NOT uploaded —
# the browser stitches them into the QGZ after this API returns.
MultiPartParser.max_part_size = 64 * 1024 * 1024  # 64 MB
if hasattr(MultiPartParser, "spool_max_size"):
    MultiPartParser.spool_max_size = 64 * 1024 * 1024

app = FastAPI(title="Farm Water Accounting QGZ API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    return {"ok": True, "service": "qgz-api"}


@app.post("/api/generate-qgz")
async def generate_qgz(request: Request):
    """
    Generate a QGZ project (data.gpkg + .qgs).

    Accepts multipart form with a `config` JSON field. Offline basemap files
    should be merged client-side — do not upload MBTiles here.
    """
    form = await request.form(max_part_size=64 * 1024 * 1024)
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

    # Strip any expectation that offline files were uploaded; keep metadata for QGS paths
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
