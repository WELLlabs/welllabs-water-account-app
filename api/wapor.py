"""FAO WaPOR v3 L1 rasters for T-Lab: the Raichur extract, or any explorer extent in India.

WaPOR has no WMS. COGs live on GCS; this router windows each file to an extent
(Raichur unless the request passes `extent=west,south,east,north`), caches the
extract, and serves point samples plus a colourised PNG.

Products:
  aeti — L1-AETI-M (300 m), stored mm/month, responses in mm/day
  pcp  — L1-PCP-M  (~5 km CHIRPS), responses in mm/month
  npp  — L1-NPP-M  (300 m), gC/m²/month
  tbp  — L1-TBP-A  (300 m), kg/ha/year  (WaPOR has no monthly TBP)
  gbwp — L1-GBWP-A (300 m), kg/m³/year (gross biomass water productivity)
"""

from __future__ import annotations

import calendar
import datetime
import io
import logging
import math
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import httpx
import numpy as np
import rasterio
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse, Response
from rasterio.windows import from_bounds as window_from_bounds
from PIL import Image

from . import wapor_fetch

log = logging.getLogger(__name__)

router = APIRouter(prefix="/fwa-api/hydro/wapor")

GCS = "https://storage.googleapis.com/fao-gismgr-wapor-3-data/DATA/WAPOR-3/MAPSET"
FIRST_YEAR = 2018
FIRST_MONTH = "2018-01"
NODATA = -9999
EXTRACT = (76.15, 15.40, 77.80, 16.75)  # west, south, east, north
Extent = tuple[float, float, float, float]
# Explorer extents: inside India, at most MAX_EXTENT_DEG on a side, snapped outward to EXTENT_STEP
INDIA = (68.0, 6.0, 98.0, 38.0)
MAX_EXTENT_DEG = float(os.environ.get("WAPOR_MAX_EXTENT_DEG", "3.0"))
EXTENT_STEP = 0.05
# How far a map bbox may reach past the extent (TLabMap snaps its overlay box out to 0.15°)
BBOX_MARGIN_DEG = 0.5
# Explorer extents whose decoded rasters stay in memory; older ones fall back to the disk cache
MAX_EXTENT_STATES = int(os.environ.get("WAPOR_MAX_EXTENT_STATES", "8"))
TIMEOUT = httpx.Timeout(20.0, connect=10.0)
NO_STORE = {"Cache-Control": "no-store"}
MAP_CACHE = {"Cache-Control": "public, max-age=86400"}
# Months queued per product while warming; the shared process pool (wapor_fetch.PROCESSES) caps real downloads
WARM_WORKERS = wapor_fetch.PROCESSES
# /latest probes GCS with HEAD requests; remember the answer instead of re-probing on every upload
LATEST_TTL = 3600.0
_latest_cache: dict[str, tuple[float, dict]] = {}

ET_RGB = np.array(
    [
        (255, 255, 160),
        (255, 255, 120),
        (192, 247, 102),
        (132, 237, 72),
        (71, 222, 49),
        (88, 182, 96),
        (60, 171, 128),
        (37, 149, 169),
        (38, 101, 154),
        (32, 58, 119),
    ],
    dtype=np.uint8,
)
# Monthly rainfall classes (mm) matching PCP_BREAKS / PCP_COLORS in src/lib/tlab.ts
PCP_BREAKS = np.array([0, 20, 40, 60, 80, 100, 150, 200, 250, 300], dtype=np.float32)
PCP_RGB = np.array(
    [
        (247, 251, 255),
        (222, 235, 247),
        (198, 219, 239),
        (158, 202, 225),
        (107, 174, 214),
        (66, 146, 198),
        (33, 113, 181),
        (8, 81, 156),
        (8, 48, 107),
        (4, 28, 58),
    ],
    dtype=np.uint8,
)
# gC/m²/month — ColorBrewer YlGn
NPP_BREAKS = np.array([0, 15, 30, 50, 75, 100, 130, 160, 200, 250], dtype=np.float32)
NPP_RGB = np.array(
    [
        (255, 255, 229),
        (247, 252, 185),
        (217, 240, 163),
        (173, 221, 142),
        (120, 198, 121),
        (65, 171, 93),
        (35, 132, 67),
        (0, 104, 55),
        (0, 69, 41),
        (0, 36, 15),
    ],
    dtype=np.uint8,
)
# kg/ha/year — ColorBrewer BuGn
TBP_BREAKS = np.array([0, 1000, 2500, 5000, 7500, 10000, 15000, 20000, 25000, 35000], dtype=np.float32)
TBP_RGB = np.array(
    [
        (247, 252, 253),
        (229, 245, 249),
        (204, 236, 230),
        (153, 216, 201),
        (102, 194, 164),
        (65, 174, 118),
        (35, 139, 69),
        (0, 109, 44),
        (0, 68, 27),
        (0, 43, 18),
    ],
    dtype=np.uint8,
)
# kg/m³/year — ColorBrewer RdYlGn (low WP red, high WP green)
GBWP_BREAKS = np.array([0, 0.3, 0.6, 0.9, 1.2, 1.5, 2.0, 2.5, 3.0, 4.0], dtype=np.float32)
GBWP_RGB = np.array(
    [
        (165, 0, 38),
        (215, 48, 39),
        (244, 109, 67),
        (253, 174, 97),
        (254, 224, 139),
        (217, 239, 139),
        (166, 217, 106),
        (102, 189, 99),
        (26, 152, 80),
        (0, 104, 55),
    ],
    dtype=np.uint8,
)


@dataclass
class Product:
    key: str
    mapset: str
    cache: Path
    scale: float
    temporal: str  # "month" | "year"
    rgb: np.ndarray
    breaks: np.ndarray | None = None
    per_day: bool = False
    decimals: int = 1


@dataclass
class ProductState:
    locks: dict[str, threading.Lock] = field(default_factory=dict)
    missing: set[str] = field(default_factory=set)
    arrays: dict[str, tuple[np.ndarray, rasterio.Affine, float | None]] = field(default_factory=dict)
    png: dict[tuple, bytes] = field(default_factory=dict)
    warm_lock: threading.Lock = field(default_factory=threading.Lock)
    warm_thread: threading.Thread | None = None
    warm_target: str | None = None


PRODUCTS = {
    "aeti": Product(
        key="aeti",
        mapset="L1-AETI-M",
        cache=Path(os.environ.get("WAPOR_AETI_CACHE", "/tmp/wapor-l1-aeti-m")),
        scale=0.1,
        temporal="month",
        rgb=ET_RGB,
        per_day=True,
        decimals=3,
    ),
    "pcp": Product(
        key="pcp",
        mapset="L1-PCP-M",
        cache=Path(os.environ.get("WAPOR_PCP_CACHE", "/tmp/wapor-l1-pcp-m")),
        scale=0.1,
        temporal="month",
        rgb=PCP_RGB,
        breaks=PCP_BREAKS,
        decimals=1,
    ),
    "npp": Product(
        key="npp",
        mapset="L1-NPP-M",
        cache=Path(os.environ.get("WAPOR_NPP_CACHE", "/tmp/wapor-l1-npp-m")),
        scale=0.001,
        temporal="month",
        rgb=NPP_RGB,
        breaks=NPP_BREAKS,
        decimals=1,
    ),
    "tbp": Product(
        key="tbp",
        mapset="L1-TBP-A",
        cache=Path(os.environ.get("WAPOR_TBP_CACHE", "/tmp/wapor-l1-tbp-a")),
        scale=1.0,
        temporal="year",
        rgb=TBP_RGB,
        breaks=TBP_BREAKS,
        decimals=0,
    ),
    "gbwp": Product(
        key="gbwp",
        mapset="L1-GBWP-A",
        cache=Path(os.environ.get("WAPOR_GBWP_CACHE", "/tmp/wapor-l1-gbwp-a")),
        scale=0.001,
        temporal="year",
        rgb=GBWP_RGB,
        breaks=GBWP_BREAKS,
        decimals=3,
    ),
}
_state: dict[tuple[str, Extent], ProductState] = {(k, EXTRACT): ProductState() for k in PRODUCTS}
_extent_order: list[Extent] = []
_locks_guard = threading.Lock()


def _st(product: Product, extent: Extent) -> ProductState:
    with _locks_guard:
        st = _state.get((product.key, extent))
        if st is None:
            st = _state[(product.key, extent)] = ProductState()
        if extent != EXTRACT:
            if extent in _extent_order:
                _extent_order.remove(extent)
            _extent_order.append(extent)
            while len(_extent_order) > MAX_EXTENT_STATES:
                old = _extent_order.pop(0)
                for key, other in _state.items():
                    if key[1] == old:
                        other.arrays.clear()
                        other.png.clear()
        return st


def _parse_extent(raw: Optional[str]) -> Extent:
    """`west,south,east,north` snapped outward to EXTENT_STEP; the Raichur extract when omitted."""
    if not raw:
        return EXTRACT
    try:
        west, south, east, north = (float(x) for x in raw.split(","))
    except ValueError:
        raise HTTPException(status_code=400, detail="extent must be west,south,east,north")
    if east <= west or north <= south:
        raise HTTPException(status_code=400, detail="extent is empty")
    snap_down = lambda v: round(math.floor(v / EXTENT_STEP + 1e-9) * EXTENT_STEP, 2)
    snap_up = lambda v: round(math.ceil(v / EXTENT_STEP - 1e-9) * EXTENT_STEP, 2)
    west, south, east, north = snap_down(west), snap_down(south), snap_up(east), snap_up(north)
    iw, is_, ie, in_ = INDIA
    if west < iw or south < is_ or east > ie or north > in_:
        raise HTTPException(status_code=400, detail="extent must be inside India")
    if east - west > MAX_EXTENT_DEG or north - south > MAX_EXTENT_DEG:
        raise HTTPException(
            status_code=400,
            detail=f"extent is larger than {MAX_EXTENT_DEG:g}° on a side; upload a smaller boundary",
        )
    return (west, south, east, north)


def _prod(raw: str) -> Product:
    p = PRODUCTS.get(raw)
    if p is None:
        raise HTTPException(status_code=400, detail="product must be aeti, pcp, npp, tbp, or gbwp")
    return p


def _cog(product: Product, period: str) -> str:
    return f"{GCS}/{product.mapset}/WAPOR-3.{product.mapset}.{period}.tif"


def _parse_month(raw: str) -> datetime.date:
    try:
        return datetime.datetime.strptime(raw, "%Y-%m").date().replace(day=1)
    except ValueError:
        raise HTTPException(status_code=400, detail="month must be YYYY-MM")


def _parse_period(product: Product, raw: str) -> str:
    if product.temporal == "year":
        if len(raw) >= 4 and raw[:4].isdigit():
            year = int(raw[:4])
            if year < FIRST_YEAR:
                raise HTTPException(status_code=400, detail="year is before WaPOR v3")
            return str(year)
        raise HTTPException(status_code=400, detail="year must be YYYY")
    m = _parse_month(raw)
    if m < _parse_month(FIRST_MONTH):
        raise HTTPException(status_code=400, detail="month is before WaPOR v3")
    return _ym(m)


def _shift(month: datetime.date, delta: int) -> datetime.date:
    idx = month.year * 12 + month.month - 1 + delta
    return datetime.date(idx // 12, idx % 12 + 1, 1)


def _ym(month: datetime.date) -> str:
    return f"{month:%Y-%m}"


def _months(first: datetime.date, last: datetime.date) -> list[datetime.date]:
    out: list[datetime.date] = []
    m = first
    while m <= last:
        out.append(m)
        m = _shift(m, 1)
    return out


def _periods(product: Product, first: str, last: str) -> list[str]:
    if product.temporal == "year":
        a, b = int(first), int(last)
        if b < a:
            raise HTTPException(status_code=400, detail="end must not be before start")
        return [str(y) for y in range(a, b + 1)]
    start = _parse_month(first)
    end = _parse_month(last)
    if end < start:
        raise HTTPException(status_code=400, detail="end must not be before start")
    return [_ym(m) for m in _months(start, end)]


def _check_point(lat: float, lng: float, extent: Extent) -> None:
    west, south, east, north = extent
    if not (south <= lat <= north and west <= lng <= east):
        where = "the Raichur extract" if extent == EXTRACT else "the region extent"
        raise HTTPException(status_code=400, detail=f"point must be inside {where}")


def _month_lock(st: ProductState, period: str) -> threading.Lock:
    with _locks_guard:
        return st.locks.setdefault(period, threading.Lock())


def _cache_path(product: Product, period: str, extent: Extent) -> Path:
    if extent == EXTRACT:
        return product.cache / f"{period}.tif"
    return product.cache / "extent" / "_".join(f"{v:.2f}" for v in extent) / f"{period}.tif"


def _download_window(product: Product, period: str, dest: Path, extent: Extent) -> bool:
    """False when WaPOR has no file for this period."""
    return wapor_fetch.download(_cog(product, period), dest, extent, product.scale, NODATA)


def _warm_month(product: Product, period: str, extent: Extent) -> Path | None:
    """Background download: waits for a warm slot before locking the month (see wapor_fetch)."""
    if _month_ready(product, period, extent):
        return ensure_month(product, period, extent)
    with wapor_fetch.warm_slot():
        return ensure_month(product, period, extent)


def ensure_month(product: Product, period: str, extent: Extent = EXTRACT) -> Path | None:
    st = _st(product, extent)
    if period in st.missing:
        return None
    path = _cache_path(product, period, extent)
    if path.exists() and path.stat().st_size > 0:
        return path
    with _month_lock(st, period):
        if period in st.missing:
            return None
        if path.exists() and path.stat().st_size > 0:
            return path
        if _download_window(product, period, path, extent):
            return path
        log.warning("WaPOR %s %s: no file", product.mapset, period)
        st.missing.add(period)
        return None


def _load_array(
    product: Product, period: str, extent: Extent = EXTRACT
) -> tuple[np.ndarray, rasterio.Affine, float | None] | None:
    st = _st(product, extent)
    cached = st.arrays.get(period)
    if cached is not None:
        return cached
    path = ensure_month(product, period, extent)
    if path is None:
        return None
    with rasterio.open(path) as src:
        arr = src.read(1)
        transform = src.transform
        nodata = src.nodata if src.nodata is not None else NODATA
    st.arrays[period] = (arr, transform, nodata)
    return arr, transform, nodata


def _physical(product: Product, raw: float, period: str) -> float:
    v = float(raw) * product.scale
    if product.per_day:
        days = calendar.monthrange(int(period[:4]), int(period[5:7]))[1]
        v /= days
    return round(v, product.decimals)


def _is_nodata(raw: float, nodata: float | None) -> bool:
    if not np.isfinite(raw):
        return True
    if nodata is None:
        return False
    return raw == nodata


def _sample(product: Product, period: str, lat: float, lng: float, extent: Extent = EXTRACT) -> dict:
    out = {"month": period, "value": None, "status": "error"}
    loaded = _load_array(product, period, extent)
    if loaded is None:
        out["status"] = "missing"
        return out
    arr, transform, nodata = loaded
    col, row = ~transform * (lng, lat)
    r, c = int(row), int(col)
    if r < 0 or c < 0 or r >= arr.shape[0] or c >= arr.shape[1]:
        out["status"] = "nodata"
        return out
    raw = float(arr[r, c])
    if _is_nodata(raw, nodata):
        out["status"] = "nodata"
        return out
    out["status"] = "ok"
    out["value"] = _physical(product, raw, period)
    return out


def _month_ready(product: Product, period: str, extent: Extent = EXTRACT) -> bool:
    st = _st(product, extent)
    return period in st.missing or _cache_path(product, period, extent).exists()


def _kick_warm(product: Product, latest: str, extent: Extent = EXTRACT) -> None:
    st = _st(product, extent)
    first = str(FIRST_YEAR) if product.temporal == "year" else FIRST_MONTH
    with st.warm_lock:
        if st.warm_target is None or latest > st.warm_target:
            st.warm_target = latest
        if st.warm_thread is not None and st.warm_thread.is_alive():
            return

        def run() -> None:
            while True:
                with st.warm_lock:
                    target = st.warm_target
                if target is None:
                    return
                periods = [
                    key for key in reversed(_periods(product, first, target)) if not _month_ready(product, key, extent)
                ]
                if not periods:
                    return
                with ThreadPoolExecutor(max_workers=WARM_WORKERS) as pool:
                    list(pool.map(lambda p: _warm_month(product, p, extent), periods))

        st.warm_thread = threading.Thread(target=run, daemon=True, name=f"wapor-warm-{product.key}")
        st.warm_thread.start()


def _parse_bbox(raw: str, extent: Extent) -> tuple[float, float, float, float]:
    try:
        west, south, east, north = (float(x) for x in raw.split(","))
    except ValueError:
        raise HTTPException(status_code=400, detail="bbox must be west,south,east,north")
    if east <= west or north <= south:
        raise HTTPException(status_code=400, detail="bbox is empty")
    # The map pads the region out to its own 0.15° grid, so allow a margin; the part outside
    # the extent is drawn transparent (_window_to_bbox), keeping the image aligned.
    ew, es, ee, en = extent
    m = BBOX_MARGIN_DEG
    if west < ew - m or south < es - m or east > ee + m or north > en + m:
        where = "the Raichur extract" if extent == EXTRACT else "the region extent"
        raise HTTPException(status_code=400, detail=f"bbox outside {where}")
    return west, south, east, north


def _valid_mask(arr: np.ndarray, nodata: float | None) -> np.ndarray:
    valid = np.isfinite(arr.astype(np.float64))
    if nodata is not None:
        valid &= arr != nodata
    return valid


def _colorize(product: Product, arr: np.ndarray, nodata: float | None, period: str, width: int, height: int) -> bytes:
    valid = _valid_mask(arr, nodata)
    phys = np.zeros(arr.shape, dtype=np.float32)
    phys[valid] = arr[valid].astype(np.float32) * product.scale
    if product.per_day:
        days = calendar.monthrange(int(period[:4]), int(period[5:7]))[1]
        phys[valid] = phys[valid] / days
    if product.breaks is None:
        idx = np.clip(np.floor(phys).astype(np.int16), 0, len(product.rgb) - 1)
    else:
        idx = np.searchsorted(product.breaks, phys, side="right") - 1
        idx = np.clip(idx, 0, len(product.rgb) - 1)
    rgba = np.zeros(arr.shape + (4,), dtype=np.uint8)
    rgba[valid, :3] = product.rgb[idx[valid]]
    rgba[valid, 3] = 255
    img = Image.fromarray(rgba, "RGBA")
    if img.size != (width, height):
        img = img.resize((width, height), Image.Resampling.NEAREST)
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def _window_to_bbox(arr: np.ndarray, transform: rasterio.Affine, bbox: tuple[float, float, float, float], nodata: float):
    """The bbox window of `arr`; pixels outside the array are nodata, so the PNG matches the bbox exactly."""
    west, south, east, north = bbox
    window = window_from_bounds(west, south, east, north, transform).round_offsets().round_lengths()
    row_off, col_off = int(window.row_off), int(window.col_off)
    h, w = max(1, int(window.height)), max(1, int(window.width))
    out = np.full((h, w), nodata, dtype=arr.dtype)
    r0, c0 = max(0, row_off), max(0, col_off)
    r1, c1 = min(arr.shape[0], row_off + h), min(arr.shape[1], col_off + w)
    if r1 > r0 and c1 > c0:
        out[r0 - row_off : r1 - row_off, c0 - col_off : c1 - col_off] = arr[r0:r1, c0:c1]
    return out

@router.get("/latest")
async def latest(product: str = Query("aeti")):
    p = _prod(product)
    hit = _latest_cache.get(p.key)
    if hit and time.monotonic() - hit[0] < LATEST_TTL:
        return JSONResponse(hit[1], headers={"Cache-Control": "public, max-age=3600"})
    body = await _probe_latest(p)
    _latest_cache[p.key] = (time.monotonic(), body)
    return JSONResponse(body, headers={"Cache-Control": "public, max-age=3600"})


async def _probe_latest(p: Product) -> dict:
    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
        if p.temporal == "year":
            year = datetime.date.today().year
            for _ in range(8):
                resp = await client.head(_cog(p, str(year)))
                if resp.status_code == 200:
                    return {
                        "first": str(FIRST_YEAR),
                        "latest": str(year),
                        "product": p.key,
                        "temporal": p.temporal,
                    }
                year -= 1
        else:
            month = datetime.date.today().replace(day=1)
            for _ in range(14):
                resp = await client.head(_cog(p, _ym(month)))
                if resp.status_code == 200:
                    return {
                        "first": FIRST_MONTH,
                        "latest": _ym(month),
                        "product": p.key,
                        "temporal": p.temporal,
                    }
                month = _shift(month, -1)
    raise HTTPException(status_code=502, detail=f"No recent WaPOR {p.mapset} layer found")


@router.get("/value")
def value(lat: float, lng: float, month: str, product: str = Query("aeti"), extent: Optional[str] = Query(None)):
    p = _prod(product)
    ext = _parse_extent(extent)
    _check_point(lat, lng, ext)
    period = _parse_period(p, month)
    return JSONResponse(_sample(p, period, lat, lng, ext), headers=NO_STORE)


@router.get("/series")
def series(
    lat: float,
    lng: float,
    start: str,
    end: Optional[str] = Query(None),
    product: str = Query("aeti"),
    extent: Optional[str] = Query(None),
):
    p = _prod(product)
    ext = _parse_extent(extent)
    _check_point(lat, lng, ext)
    first = _parse_period(p, start)
    last = _parse_period(p, end) if end else (
        str(datetime.date.today().year) if p.temporal == "year" else _ym(datetime.date.today().replace(day=1))
    )
    keys = _periods(p, first, last)
    _kick_warm(p, last, ext)
    points = []
    pending = 0
    for key in keys:
        if not _month_ready(p, key, ext):
            pending += 1
            continue
        points.append(_sample(p, key, lat, lng, ext))
    while points and points[-1]["status"] == "missing":
        points.pop()
    return JSONResponse(
        {"lat": lat, "lng": lng, "product": p.key, "series": points, "complete": pending == 0},
        headers=NO_STORE,
    )


@router.get("/map.png")
def map_png(
    month: str,
    bbox: str,
    width: int = Query(900, ge=64, le=2048),
    height: int = Query(None),
    product: str = Query("aeti"),
    extent: Optional[str] = Query(None),
):
    p = _prod(product)
    ext = _parse_extent(extent)
    st = _st(p, ext)
    key = _parse_period(p, month)
    west, south, east, north = _parse_bbox(bbox, ext)
    if height is None:
        height = max(1, round(width * (north - south) / (east - west)))
    height = max(64, min(2048, int(height)))
    cache_key = (key, round(west, 4), round(south, 4), round(east, 4), round(north, 4), width, height)
    cached = st.png.get(cache_key)
    if cached is not None:
        return Response(cached, media_type="image/png", headers=MAP_CACHE)
    loaded = _load_array(p, key, ext)
    if loaded is None:
        raise HTTPException(status_code=404, detail=f"no WaPOR {p.mapset} layer for {key}")
    arr, transform, nodata = loaded
    sliced = _window_to_bbox(arr, transform, (west, south, east, north), NODATA if nodata is None else nodata)
    png = _colorize(p, sliced, nodata, key, width, height)
    if len(st.png) > 48:
        st.png.pop(next(iter(st.png)))
    st.png[cache_key] = png
    return Response(png, media_type="image/png", headers=MAP_CACHE)
