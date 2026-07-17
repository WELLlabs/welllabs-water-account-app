"""Assemble a .qgz (ZIP) from GPKG + QGS + optional offline basemap files."""

from __future__ import annotations

import io
import re
import zipfile
from typing import Any

from .gpkg_builder import write_gpkg_bytes
from .qgs_builder import build_qgs_project, create_layer_ids


def _safe_name(name: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]", "_", name or "")
    return cleaned or "farm_survey"


def build_qgz(
    config: dict[str, Any],
    offline_files: dict[str, bytes] | None = None,
) -> tuple[bytes, str]:
    """
    Build a QGZ archive.

    offline_files: map of filename -> file bytes for MBTiles/GeoTIFF basemaps.
    Returns (qgz_bytes, suggested_filename).
    """
    offline_files = offline_files or {}
    basemaps = config.get("basemaps") or []

    # Ensure offline basemap entries have fileName set from uploaded files
    for bm in basemaps:
        if not bm.get("requiresInternet", True) and not bm.get("fileName"):
            # try to match any uploaded file
            if offline_files:
                bm["fileName"] = next(iter(offline_files.keys()))

    layer_ids = create_layer_ids(len(basemaps))
    gpkg_bytes = write_gpkg_bytes(config)
    qgs_xml = build_qgs_project(config, layer_ids)

    project_base = _safe_name(config.get("projectName") or "Farm Survey")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        zf.writestr(f"{project_base}.qgs", qgs_xml.encode("utf-8"))
        zf.writestr("data.gpkg", gpkg_bytes)
        for file_name, data in offline_files.items():
            # store under the basename referenced in the QGS
            zf.writestr(file_name, data)

    return buf.getvalue(), f"{project_base}.qgz"
