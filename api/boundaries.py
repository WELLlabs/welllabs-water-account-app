"""Ready-made boundaries for the Data Explorers: India districts and CWC canal command areas.

Each dataset is a FlatGeobuf in WGS84. The file is read from BOUNDARY_DIR when present
(local development), otherwise downloaded once from the project S3 bucket and revalidated
against its ETag every TLAB_LAYER_TTL seconds.

The list endpoint returns a compact search index (name, state, district, area) built once per
file version; the geometry endpoint reads only the selected features from the file by FID, so
the full geometries never stay in memory.
"""

from __future__ import annotations

import logging
import os
import tempfile
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

import geopandas as gpd
import orjson
import pandas as pd
import pyogrio
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from shapely.geometry import mapping
from shapely.ops import unary_union
from shapely.validation import make_valid

from .layers import BUCKET, TTL_SECONDS, _s3

log = logging.getLogger(__name__)

router = APIRouter(prefix="/fwa-api/boundaries")

ROOT = Path(__file__).resolve().parent.parent
BOUNDARY_DIR = Path(os.environ.get("BOUNDARY_DIR", ROOT / "data" / "boundaries"))
CACHE_DIR = Path(os.environ.get("BOUNDARY_CACHE_DIR", Path(tempfile.gettempdir()) / "welllabs-boundaries"))
# Equal-area CRS for km² in the index
AREA_CRS = 6933

STATES = {
    "AN": "Andaman and Nicobar Islands", "AP": "Andhra Pradesh", "AR": "Arunachal Pradesh", "AS": "Assam",
    "BR": "Bihar", "CG": "Chhattisgarh", "CH": "Chandigarh", "DD": "Daman and Diu",
    "DL": "Delhi", "DN": "Dadra and Nagar Haveli", "GA": "Goa", "GJ": "Gujarat", "HP": "Himachal Pradesh",
    "HR": "Haryana", "JH": "Jharkhand", "JK": "Jammu and Kashmir", "KA": "Karnataka", "KL": "Kerala",
    "LD": "Lakshadweep", "LK": "Ladakh", "MH": "Maharashtra", "MS": "Maharashtra", "ML": "Meghalaya",
    "MN": "Manipur", "MP": "Madhya Pradesh", "MZ": "Mizoram", "NL": "Nagaland", "OD": "Odisha", "OR": "Odisha",
    "PB": "Punjab", "PY": "Puducherry", "RJ": "Rajasthan", "SK": "Sikkim", "TN": "Tamil Nadu", "TR": "Tripura",
    "TS": "Telangana", "UK": "Uttarakhand", "UP": "Uttar Pradesh", "WB": "West Bengal",
}


def _text(value) -> str:
    return "" if value is None or pd.isna(value) else str(value).strip()


def _state(code) -> str:
    code = _text(code).upper()
    return STATES.get(code, code)


@dataclass
class Entry:
    id: str
    name: str
    fids: list[int]
    state: str = ""
    district: str = ""
    area_km2: float = 0.0
    extra: dict = field(default_factory=dict)

    def public(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "state": self.state,
            "district": self.district,
            "areaKm2": round(self.area_km2, 1),
            **self.extra,
        }


class _Source:
    """One FlatGeobuf, local or from S3, with a search index rebuilt when the file changes."""

    def __init__(self, key_env: str, default_key: str, build: Callable[["_Source", Path], list[Entry]]):
        self.key = os.environ.get(key_env, default_key)
        self.key_env = key_env
        self.build = build
        self.lock = threading.Lock()
        self.path: Optional[Path] = None
        self.etag: Optional[str] = None
        self.checked = 0.0
        self.entries: dict[str, Entry] = {}
        self.body: Optional[bytes] = None

    def _local(self) -> Optional[Path]:
        p = BOUNDARY_DIR / self.key
        return p if p.is_file() else None

    def _refresh(self) -> None:
        local = self._local()
        if local is not None:
            version = f"{local.stat().st_mtime_ns}:{local.stat().st_size}"
            if version != self.etag:
                self._load(local, version)
            return
        if not BUCKET:
            raise HTTPException(
                status_code=503,
                detail=f"{self.key} is not in {BOUNDARY_DIR} and no layer bucket is configured (set AWS_S3_BUCKET_NAME).",
            )
        if self.path is not None and time.monotonic() - self.checked < TTL_SECONDS:
            return
        s3 = _s3()
        try:
            head = s3.head_object(Bucket=BUCKET, Key=self.key)
            if self.path is not None and head["ETag"] == self.etag:
                self.checked = time.monotonic()
                return
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            tag = head["ETag"].strip('"')
            dest = CACHE_DIR / f"{tag}-{Path(self.key).name}"
            if not dest.is_file():
                tmp = dest.with_suffix(".part")
                s3.download_file(BUCKET, self.key, str(tmp))
                tmp.replace(dest)
        except (ClientError, BotoCoreError) as e:
            if self.path is not None:
                log.warning("Serving cached %s; could not revalidate s3://%s/%s: %s", self.key_env, BUCKET, self.key, e)
                self.checked = time.monotonic()
                return
            raise HTTPException(status_code=502, detail=f"Could not read s3://{BUCKET}/{self.key}: {e}") from e
        self._load(dest, head["ETag"])
        self.checked = time.monotonic()

    def _load(self, path: Path, version: str) -> None:
        try:
            entries = self.build(self, path)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Could not index {self.key}: {e}") from e
        entries.sort(key=lambda e: (e.name.lower(), e.state, e.district))
        self.entries = {e.id: e for e in entries}
        self.body = orjson.dumps({"items": [e.public() for e in entries]})
        old = self.path
        self.path, self.etag = path, version
        if old is not None and old != path and old.parent == CACHE_DIR:
            old.unlink(missing_ok=True)

    def index(self) -> bytes:
        with self.lock:
            self._refresh()
            assert self.body is not None
            return self.body

    def feature(self, entry_id: str) -> dict:
        with self.lock:
            self._refresh()
            entry = self.entries.get(entry_id)
            path = self.path
        if entry is None or path is None:
            raise HTTPException(status_code=404, detail="Unknown boundary; reload the list and pick it again.")
        gdf = pyogrio.read_dataframe(path, fids=entry.fids, columns=[])
        geom = unary_union([make_valid(g) for g in gdf.geometry if g is not None and not g.is_empty])
        return {
            "type": "FeatureCollection",
            "features": [{"type": "Feature", "properties": entry.public(), "geometry": mapping(geom)}],
        }


def _read_with_fids(path: Path, columns: list[str]) -> gpd.GeoDataFrame:
    gdf = pyogrio.read_dataframe(path, columns=columns, fid_as_index=True)
    if gdf.crs is None:
        gdf = gdf.set_crs(4326)
    elif not gdf.crs.equals("EPSG:4326"):
        raise ValueError(f"expected WGS84, got {gdf.crs}")
    return gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty]


def _build_districts(_: _Source, path: Path) -> list[Entry]:
    gdf = _read_with_fids(path, ["district_c", "District", "State"])
    area = gdf.geometry.to_crs(AREA_CRS).area / 1e6
    return [
        Entry(
            id=_text(row.district_c) or str(fid),
            name=_text(row.District) or f"District {fid}",
            fids=[int(fid)],
            state=_state(row.State),
            area_km2=float(area.loc[fid]),
        )
        for fid, row in gdf.iterrows()
    ]


def _district_lookup() -> Optional[gpd.GeoDataFrame]:
    """District names for points, to label canal commands that have no name or state."""
    try:
        with DISTRICTS.lock:
            DISTRICTS._refresh()
            path = DISTRICTS.path
        if path is None:
            return None
        return _read_with_fids(path, ["District", "State"])
    except Exception as e:
        log.warning("Canal commands indexed without district names: %s", e)
        return None


def _build_commands(_: _Source, path: Path) -> list[Entry]:
    gdf = _read_with_fids(path, ["CNAME", "TYPE", "STATUS", "STATE", "CMDCODE"])
    area = gdf.geometry.to_crs(AREA_CRS).area / 1e6
    points = gpd.GeoDataFrame(geometry=gdf.geometry.representative_point(), index=gdf.index, crs=gdf.crs)

    district = pd.Series("", index=gdf.index)
    district_state = pd.Series("", index=gdf.index)
    lookup = _district_lookup()
    if lookup is not None:
        hits = gpd.sjoin(points, lookup, how="left", predicate="within")
        hits = hits[~hits.index.duplicated()]
        district = hits["District"].map(_text)
        district_state = hits["State"].map(_state)

    groups: dict[tuple[str, str], list[int]] = {}
    for fid, row in gdf.iterrows():
        name = _text(row.CNAME)
        state = _state(row.STATE) or district_state.loc[fid]
        key = (name.lower(), state) if name else (f"#{fid}", state)
        groups.setdefault(key, []).append(int(fid))

    entries = []
    for (_, state), fids in groups.items():
        first = gdf.loc[fids[0]]
        name = _text(first.CNAME)
        codes = sorted({_text(gdf.loc[f].CMDCODE) for f in fids} - {""})
        districts = sorted({district.loc[f] for f in fids} - {""})
        kind = _text(first.TYPE)
        status = _text(first.STATUS).capitalize().replace("Prposed", "Proposed")
        entries.append(
            Entry(
                id=codes[0] if codes else f"fid{fids[0]}",
                name=name or f"Unnamed command {codes[0] if codes else fids[0]}",
                fids=fids,
                state=state,
                district=", ".join(districts[:3]) + ("…" if len(districts) > 3 else ""),
                area_km2=float(area.loc[fids].sum()),
                extra={"type": kind, "status": status, "parts": len(fids)},
            )
        )
    # Codes repeat across a few groups; keep ids unique
    seen: dict[str, int] = {}
    for e in entries:
        n = seen.get(e.id, 0)
        seen[e.id] = n + 1
        if n:
            e.id = f"{e.id}-{n}"
    return entries


DISTRICTS = _Source("BOUNDARY_DISTRICTS_KEY", "India_District.fgb", _build_districts)
COMMANDS = _Source("BOUNDARY_COMMANDS_KEY", "CWC_Command_Areas.fgb", _build_commands)
SOURCES = {"districts": DISTRICTS, "commands": COMMANDS}


def _source(dataset: str) -> _Source:
    src = SOURCES.get(dataset)
    if src is None:
        raise HTTPException(status_code=404, detail=f"Unknown boundary set {dataset!r}.")
    return src


@router.get("/{dataset}")
def boundary_index(dataset: str):
    """Every boundary in the set, for the explorer's search box (no geometry)."""
    return Response(_source(dataset).index(), media_type="application/json", headers={"Cache-Control": "no-cache"})


@router.get("/{dataset}/{entry_id}")
def boundary_feature(dataset: str, entry_id: str):
    """One boundary as a WGS84 FeatureCollection, ready for /fwa-api/agri/region/cells."""
    body = orjson.dumps(_source(dataset).feature(entry_id))
    return Response(body, media_type="application/geo+json", headers={"Cache-Control": "no-cache"})
