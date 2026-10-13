"""Live proxy to Google's Agricultural Understanding API (T-Lab + Crop Calc water budget).

Nothing is cached or written to disk: every request hits Google and the
response is streamed back with Cache-Control: no-store.

Every upstream call goes through one process-wide token bucket so the project
stays under Google's 5000 requests/minute quota no matter how many users or
region scans run at once. The service runs uvicorn with --workers 1; more
workers would each get their own bucket and need AGRI_RATE_PER_MIN divided
between them.
"""

from __future__ import annotations

import asyncio
import datetime
import json
import math
import os
import random
import time
from pathlib import Path
from typing import Any, Optional

import httpx
import s2sphere
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from pyproj import CRS, Transformer
from shapely.geometry import Polygon, mapping, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform as shapely_transform
from shapely.ops import unary_union
from shapely.prepared import prep
from shapely.validation import make_valid

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

AGRI_BASE = "https://agriculturalunderstanding.googleapis.com/v1"
S2_LEVEL = 13
TIMEOUT = httpx.Timeout(60.0, connect=10.0)

RATE_PER_MIN = int(os.environ.get("AGRI_RATE_PER_MIN", "4500"))
MAX_CONCURRENCY = int(os.environ.get("AGRI_MAX_CONCURRENCY", "48"))
MAX_ATTEMPTS = 5
RETRY_STATUS = {429, 500, 502, 503, 504}

# ~130 fields and ~100 KB of GeoJSON per cell; 600 cells keeps the browser payload near 60 MB.
# Larger boundaries switch to per-cell crop totals (a few KB per cell) up to MAX_SUMMARY_CELLS.
MAX_REGION_CELLS = int(os.environ.get("AGRI_MAX_REGION_CELLS", "600"))
MAX_SUMMARY_CELLS = int(os.environ.get("AGRI_MAX_SUMMARY_CELLS", "12000"))
MAX_DETAIL_CELLS = 4
IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
# Below MAX_CONCURRENCY so cell clicks still get upstream slots while a region streams
REGION_WORKERS = int(os.environ.get("AGRI_REGION_WORKERS", "40"))
# Mean S2 level-13 cell area; used only to reject absurd boundaries before covering them
S2_L13_KM2 = 1.27

router = APIRouter(prefix="/fwa-api/agri")


class _RateLimiter:
    """Token bucket. Burst is one second of refill, so any 60 s window sees at most
    rate + rate/60 requests (4575 at the default), leaving headroom under 5000."""

    def __init__(self, per_minute: int):
        self.rate = per_minute / 60.0
        self.capacity = max(1.0, self.rate)
        self.tokens = self.capacity
        self.updated = time.monotonic()
        self.paused_until = 0.0
        self._lock: Optional[asyncio.Lock] = None

    async def acquire(self) -> None:
        if self._lock is None:
            self._lock = asyncio.Lock()
        async with self._lock:
            while True:
                now = time.monotonic()
                if now < self.paused_until:
                    await asyncio.sleep(self.paused_until - now)
                    continue
                self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.rate)
                self.updated = now
                if self.tokens >= 1:
                    self.tokens -= 1
                    return
                await asyncio.sleep((1 - self.tokens) / self.rate)

    def pause(self, seconds: float) -> None:
        """Stop every caller after an upstream 429, not just the one that saw it."""
        self.paused_until = max(self.paused_until, time.monotonic() + seconds)
        self.tokens = 0


_limiter = _RateLimiter(RATE_PER_MIN)
_semaphore: Optional[asyncio.Semaphore] = None
_http: Optional[httpx.AsyncClient] = None


def _client() -> httpx.AsyncClient:
    global _http
    if _http is None:
        _http = httpx.AsyncClient(
            timeout=TIMEOUT,
            limits=httpx.Limits(max_connections=MAX_CONCURRENCY, max_keepalive_connections=MAX_CONCURRENCY),
        )
    return _http


def _concurrency() -> asyncio.Semaphore:
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(MAX_CONCURRENCY)
    return _semaphore


def _api_key() -> str:
    key = os.environ.get("AGRI_API_KEY") or os.environ.get("API_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="Agricultural Understanding API key is not configured")
    return key


def _s2_level(cell_id: int) -> int:
    lsb = cell_id & -cell_id
    return 30 - (lsb.bit_length() - 1) // 2


def _validate_cell_id(raw: str) -> str:
    if not raw.isdigit() or len(raw) > 20:
        raise HTTPException(status_code=400, detail="cell_id must be a decimal S2 cell id")
    value = int(raw)
    if value <= 0 or value >= 2**64 or _s2_level(value) != S2_LEVEL:
        raise HTTPException(status_code=400, detail=f"cell_id must be an S2 level-{S2_LEVEL} cell")
    return raw


def _retry_delay(resp: Optional[httpx.Response], attempt: int) -> float:
    if resp is not None:
        raw = resp.headers.get("retry-after")
        if raw and raw.isdigit():
            return min(60.0, float(raw))
    return min(30.0, 2.0**attempt) + random.uniform(0, 1)


def _error_message(resp: httpx.Response) -> str:
    try:
        return resp.json().get("error", {}).get("message") or resp.text
    except ValueError:
        return resp.text


async def _call(client: httpx.AsyncClient, method: str, body: dict, key: str) -> dict:
    last = MAX_ATTEMPTS - 1
    for attempt in range(MAX_ATTEMPTS):
        await _limiter.acquire()
        try:
            async with _concurrency():
                resp = await client.post(f"{AGRI_BASE}:{method}", params={"key": key}, json=body)
        except httpx.TransportError as exc:
            if attempt == last:
                raise HTTPException(status_code=502, detail={"upstream": method, "message": str(exc)[:500]})
            await asyncio.sleep(_retry_delay(None, attempt))
            continue

        if resp.status_code == 200:
            return resp.json()
        if resp.status_code in RETRY_STATUS and attempt < last:
            delay = _retry_delay(resp, attempt)
            print(f"[agri] {method} {resp.status_code}, retry {attempt + 1} in {delay:.1f}s", flush=True)
            if resp.status_code == 429:
                _limiter.pause(delay)
            await asyncio.sleep(delay)
            continue
        raise HTTPException(
            status_code=502,
            detail={"upstream": method, "status": resp.status_code, "message": _error_message(resp)[:500]},
        )
    raise HTTPException(status_code=502, detail={"upstream": method, "message": "retries exhausted"})


def _parse_geojson(payload: dict, wrapper: str) -> tuple[list[dict], dict | None]:
    inner = payload.get(wrapper) or {}
    raw = inner.get("geojson")
    if not raw:
        return [], inner.get("dataVersion")
    fc = json.loads(raw)
    return fc.get("features") or [], inner.get("dataVersion")


def _parse_date(raw: str) -> dict:
    try:
        d = datetime.date.fromisoformat(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    return {"year": d.year, "month": d.month, "day": d.day}


@router.get("/cell/{cell_id}/dates")
async def agri_cell_dates(cell_id: str):
    cell = _validate_cell_id(cell_id)
    key = _api_key()
    res = await _call(_client(), "lookupLandscapeCaptureDate", {"locationSpecifier": {"s2CellId": cell}}, key)
    dates = sorted(
        f"{d['year']:04d}-{d['month']:02d}-{d['day']:02d}"
        for d in res.get("captureDates") or []
        if d.get("year") and d.get("month") and d.get("day")
    )
    return JSONResponse(
        {"cellId": cell, "dataVersion": res.get("dataVersion"), "dates": dates},
        headers={"Cache-Control": "no-store"},
    )


@router.get("/cell/{cell_id}")
async def agri_cell(cell_id: str, nonAg: bool = Query(True), date: Optional[str] = Query(None)):
    cell = _validate_cell_id(cell_id)
    key = _api_key()

    lookup_body: dict = {"locationSpecifier": {"s2CellId": cell}, "includeNonAgriculturalAreas": nonAg}
    if date:
        lookup_body["captureDate"] = _parse_date(date)
    # monitorLandscape rejects includeNonAgriculturalAreas
    monitor_body = {"locationSpecifier": {"s2CellId": cell}}

    client = _client()
    lookup_res, monitor_res = await asyncio.gather(
        _call(client, "lookupLandscape", lookup_body, key),
        _call(client, "monitorLandscape", monitor_body, key),
        return_exceptions=True,
    )

    if isinstance(lookup_res, HTTPException):
        raise lookup_res
    if isinstance(lookup_res, Exception):
        raise HTTPException(status_code=502, detail={"upstream": "lookupLandscape", "message": str(lookup_res)})

    features, data_version = _parse_geojson(lookup_res, "landscape")

    warnings: list[str] = []
    if isinstance(monitor_res, Exception):
        detail = monitor_res.detail if isinstance(monitor_res, HTTPException) else str(monitor_res)
        warnings.append(f"Crop history unavailable: {detail}")
    else:
        monitored, _ = _parse_geojson(monitor_res, "monitoredLandscape")
        predictions = {
            f.get("id"): f.get("properties", {}).get("monitoring_prediction")
            for f in monitored
            if f.get("id") and f.get("properties", {}).get("monitoring_prediction")
        }
        for f in features:
            preds = predictions.get(f.get("id"))
            if preds:
                f.setdefault("properties", {})["monitoring_prediction"] = preds

    return JSONResponse(
        {
            "type": "FeatureCollection",
            "cellId": cell,
            "captureDate": date,
            "dataVersion": data_version,
            "includeNonAgriculturalAreas": nonAg,
            "warnings": warnings,
            "features": features,
        },
        headers={"Cache-Control": "no-store"},
    )


# ── Region water budget ──────────────────────────────────────────────────────


class RegionRequest(BaseModel):
    """A GeoJSON Geometry, Feature or FeatureCollection (WGS84, or with a legacy "crs" member).

    `cells` limits a request to cells of the boundary's covering: a few for fields (cell
    drill-down), any number for summaries (retrying failed cells).
    """

    geometry: dict[str, Any]
    cells: Optional[list[str]] = None


def _geometries(obj: dict) -> list[dict]:
    kind = obj.get("type")
    if kind == "FeatureCollection":
        return [g for f in obj.get("features") or [] for g in _geometries(f)]
    if kind == "Feature":
        return [obj["geometry"]] if obj.get("geometry") else []
    if kind == "GeometryCollection":
        return [g for sub in obj.get("geometries") or [] for g in _geometries(sub)]
    return [obj] if kind else []


def _declared_crs(geojson: dict) -> Optional[str]:
    """Named CRS from a legacy GeoJSON "crs" member (e.g. QGIS exports), if not WGS84."""
    name = ((geojson.get("crs") or {}).get("properties") or {}).get("name")
    if not name or name.upper().endswith(("CRS84", "EPSG::4326", "EPSG:4326")):
        return None
    return name


def _to_wgs84(geom: BaseGeometry, crs_name: str) -> BaseGeometry:
    try:
        transformer = Transformer.from_crs(CRS.from_user_input(crs_name), CRS.from_epsg(4326), always_xy=True)
    except Exception:
        raise HTTPException(status_code=400, detail=f"Unknown coordinate system {crs_name!r} in the boundary file.")
    return shapely_transform(transformer.transform, geom)


def _region_shape(geojson: dict) -> BaseGeometry:
    crs_name = _declared_crs(geojson)
    try:
        parts = [make_valid(shape(g)) for g in _geometries(geojson)]
        if crs_name:
            parts = [make_valid(_to_wgs84(p, crs_name)) for p in parts]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not read boundary geometry: {exc}")
    region = unary_union([p for p in parts if p.geom_type in ("Polygon", "MultiPolygon", "GeometryCollection")])
    if region.geom_type == "GeometryCollection":
        region = unary_union([g for g in region.geoms if g.geom_type in ("Polygon", "MultiPolygon")])
    if region.is_empty or region.area == 0:
        raise HTTPException(status_code=400, detail="The boundary file has no polygon area.")
    minx, miny, maxx, maxy = region.bounds
    if minx < -180 or maxx > 180 or miny < -90 or maxy > 90:
        raise HTTPException(
            status_code=400,
            detail=(
                "Boundary coordinates are not longitude/latitude and the file does not say which "
                "coordinate system it uses. Re-export it as WGS84 (EPSG:4326), or upload the shapefile with its .prj."
            ),
        )
    return region


def _area_km2(region: BaseGeometry) -> float:
    lat = math.radians((region.bounds[1] + region.bounds[3]) / 2)
    return region.area * (111.32**2) * math.cos(lat)


def _too_large(cells: int) -> HTTPException:
    return HTTPException(
        status_code=413,
        detail=(
            f"The boundary covers about {cells:,} S2 cells; the limit is {MAX_SUMMARY_CELLS:,} "
            f"(about {round(MAX_SUMMARY_CELLS * S2_L13_KM2):,} km²). Split it into smaller areas."
        ),
    )


def _cell_ring(cell_id: str) -> list[list[float]]:
    cell = s2sphere.Cell(s2sphere.CellId(int(cell_id)))
    ring = []
    for i in range(4):
        ll = s2sphere.LatLng.from_point(cell.get_vertex(i))
        ring.append([round(ll.lng().degrees, 6), round(ll.lat().degrees, 6)])
    return ring


def _cover(region: BaseGeometry) -> list[str]:
    minx, miny, maxx, maxy = region.bounds
    lat = math.radians((miny + maxy) / 2)
    bbox_km2 = (maxx - minx) * (maxy - miny) * (111.32**2) * math.cos(lat)
    if bbox_km2 / S2_L13_KM2 > MAX_SUMMARY_CELLS * 4:
        raise _too_large(round(_area_km2(region) / S2_L13_KM2))

    rect = s2sphere.LatLngRect.from_point_pair(
        s2sphere.LatLng.from_degrees(miny, minx),
        s2sphere.LatLng.from_degrees(maxy, maxx),
    )
    coverer = s2sphere.RegionCoverer()
    coverer.min_level = S2_LEVEL
    coverer.max_level = S2_LEVEL
    coverer.max_cells = 1_000_000

    prepared = prep(region)
    cells = [str(cid.id()) for cid in coverer.get_covering(rect) if prepared.intersects(Polygon(_cell_ring(str(cid.id()))))]
    if len(cells) > MAX_SUMMARY_CELLS:
        raise _too_large(len(cells))
    return cells


def _round_coords(coords: Any) -> Any:
    if isinstance(coords, (int, float)):
        return round(coords, 6)
    return [_round_coords(c) for c in coords]


def _compact_predictions(preds: list[dict] | None) -> list[list]:
    out = []
    for p in preds or []:
        out.append(
            [
                p.get("start_timestamp_sec"),
                p.get("end_timestamp_sec"),
                p.get("crop_1"),
                round(p.get("conf_1") or 0, 3),
                p.get("crop_2"),
                round(p.get("conf_2") or 0, 3),
            ]
        )
    return out


def _inside_fields(features: list[dict], prepared):
    """Farm fields whose centroid lies inside the boundary.

    monitorLandscape returns each field from exactly one cell (the one holding its centroid),
    so fields never repeat across cells and a cell's drill-down matches its share of the totals.
    """
    for f in features:
        props = f.get("properties") or {}
        fid = f.get("id")
        geom = f.get("geometry")
        if props.get("alu_type") != "field" or not fid or not geom:
            continue
        try:
            inside = prepared.contains(shape(geom).centroid)
        except Exception:
            continue
        if inside:
            yield fid, geom, props


def _region_fields(features: list[dict], prepared, cell: str) -> dict:
    return {
        "features": [
            {
                "type": "Feature",
                "id": fid,
                "geometry": {"type": geom["type"], "coordinates": _round_coords(geom["coordinates"])},
                "properties": {
                    "cell": cell,
                    "area_sq_m": round(props.get("area_sq_m") or 0, 1),
                    "pred": _compact_predictions(props.get("monitoring_prediction")),
                },
            }
            for fid, geom, props in _inside_fields(features, prepared)
        ]
    }


def _season_key(sec: float) -> str:
    """Same labels as seasonLabel() in src/lib/tlab.ts, evaluated in India time."""
    d = datetime.datetime.fromtimestamp(sec, IST)
    m, y = d.month - 1, d.year
    if 5 <= m <= 8:
        return f"Kharif {y}"
    if m >= 9:
        return f"Rabi {y}–{str(y + 1)[2:]}"
    if m == 0:
        return f"Rabi {y - 1}–{str(y)[2:]}"
    return f"Summer {y}"


def _conf_band(conf: float) -> int:
    """0: <30 %, 1: 30–50 %, 2: 50–70 %, 3: ≥70 %; matches the UI confidence filter steps."""
    return 0 if conf < 0.3 else 1 if conf < 0.5 else 2 if conf < 0.7 else 3


def _cell_summary(features: list[dict], prepared, cell: str) -> dict:
    """Per-cell totals: rows of [season, sowing month, crop, confidence band, plots, area m²].

    Each field contributes its most confident prediction per season, like the plot view.
    """
    plots = 0
    area = 0.0
    agg: dict[tuple, list] = {}
    for _, _, props in _inside_fields(features, prepared):
        a = props.get("area_sq_m") or 0
        plots += 1
        area += a
        best: dict[str, dict] = {}
        for p in props.get("monitoring_prediction") or []:
            start = p.get("start_timestamp_sec")
            if not start:
                continue
            key = _season_key(start)
            if key not in best or (p.get("conf_1") or 0) > (best[key].get("conf_1") or 0):
                best[key] = p
        for key, p in best.items():
            month = datetime.datetime.fromtimestamp(p["start_timestamp_sec"], IST).strftime("%Y-%m")
            k = (key, month, p.get("crop_1") or "NO_PREDICTION", _conf_band(p.get("conf_1") or 0))
            e = agg.setdefault(k, [0, 0.0])
            e[0] += 1
            e[1] += a
    return {
        "ring": _cell_ring(cell),
        "plots": plots,
        "area": round(area, 1),
        "rows": [[*k, v[0], round(v[1], 1)] for k, v in agg.items()],
    }


def _detail_text(detail: Any) -> str:
    if isinstance(detail, dict):
        return str(detail.get("message") or detail)
    return str(detail)


def _stream_cells(cells: list[str], region: BaseGeometry, handler) -> StreamingResponse:
    """NDJSON: {"type":"start"}, one {"type":"cell"} per cell (handler output or "error"), {"type":"done"}."""
    key = _api_key()
    prepared = prep(region)
    client = _client()

    async def stream():
        queue: asyncio.Queue = asyncio.Queue()
        pending = iter(cells)
        async def worker() -> None:
            for cell in pending:
                msg: dict[str, Any] = {"type": "cell", "cellId": cell}
                try:
                    res = await _call(client, "monitorLandscape", {"locationSpecifier": {"s2CellId": cell}}, key)
                    features, _ = _parse_geojson(res, "monitoredLandscape")
                    msg.update(handler(features, prepared, cell))
                except HTTPException as exc:
                    msg["error"] = _detail_text(exc.detail)
                except Exception as exc:
                    msg["error"] = str(exc)[:300]
                await queue.put(msg)

        workers = [asyncio.create_task(worker()) for _ in range(min(REGION_WORKERS, len(cells)))]
        failed = 0
        try:
            yield json.dumps(
                {"type": "start", "cells": len(cells), "areaKm2": round(_area_km2(region), 2), "ratePerMinute": RATE_PER_MIN}
            ) + "\n"
            for done in range(1, len(cells) + 1):
                msg = await queue.get()
                msg["done"] = done
                if "error" in msg:
                    failed += 1
                yield json.dumps(msg, separators=(",", ":"), ensure_ascii=False) + "\n"
            yield json.dumps({"type": "done", "cells": len(cells), "failed": failed}) + "\n"
        finally:
            for w in workers:
                w.cancel()

    return StreamingResponse(
        stream(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@router.post("/region/plan")
async def region_plan(req: RegionRequest):
    """Cell count, mode and expected duration for a boundary, without calling Google.

    Also returns the boundary in WGS84 (~10 m simplified) for the map and later requests.
    """
    region = _region_shape(req.geometry)
    cells = _cover(region)
    rate_secs = len(cells) / (RATE_PER_MIN / 60)
    return JSONResponse(
        {
            "boundary": mapping(region.simplify(0.0001, preserve_topology=True)),
            "cells": len(cells),
            "mode": "plots" if len(cells) <= MAX_REGION_CELLS else "summary",
            "maxCells": MAX_SUMMARY_CELLS,
            "maxPlotCells": MAX_REGION_CELLS,
            "areaKm2": round(_area_km2(region), 2),
            "ratePerMinute": RATE_PER_MIN,
            "estimatedSeconds": round(max(rate_secs, len(cells) * 1.5 / REGION_WORKERS), 1),
        },
        headers={"Cache-Control": "no-store"},
    )


@router.post("/region/fields")
async def region_fields(req: RegionRequest):
    """Farm fields (geometry + crop history) per S2 cell, as NDJSON.

    Whole boundaries up to MAX_REGION_CELLS, or `cells` (a few cells of a larger boundary).
    One monitorLandscape call per cell returns field geometry and monitoring_prediction together.
    """
    region = _region_shape(req.geometry)
    cells = _cover(region)
    if req.cells is not None:
        covering = set(cells)
        cells = [c for c in dict.fromkeys(req.cells) if c in covering]
        if not cells or len(cells) > MAX_DETAIL_CELLS:
            raise HTTPException(status_code=400, detail=f"Ask for 1–{MAX_DETAIL_CELLS} cells inside the boundary.")
    elif len(cells) > MAX_REGION_CELLS:
        raise HTTPException(
            status_code=413,
            detail=f"{len(cells):,} cells is too many for plot-level results (limit {MAX_REGION_CELLS:,}); use the region summary.",
        )
    if not cells:
        raise HTTPException(status_code=400, detail="The boundary does not cover any S2 cells.")
    return _stream_cells(cells, region, _region_fields)


@router.post("/region/summary")
async def region_summary(req: RegionRequest):
    """Per-cell crop/season/sowing-month totals for large boundaries, as NDJSON (no plot geometry)."""
    region = _region_shape(req.geometry)
    cells = _cover(region)
    if req.cells is not None:
        covering = set(cells)
        cells = [c for c in dict.fromkeys(req.cells) if c in covering]
    if not cells:
        raise HTTPException(status_code=400, detail="The boundary does not cover any S2 cells.")
    return _stream_cells(cells, region, _cell_summary)
