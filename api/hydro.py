"""Pass-through point queries against NRSC Bhuvan NHP evapotranspiration.

The browser loads map images from Bhuvan directly; this router exists only because
Bhuvan sends no CORS headers. Nothing is cached or stored. (Soil moisture comes from
Open-Meteo, which allows browser requests, so it needs no proxy.)
"""

from __future__ import annotations

import asyncio
import datetime
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

ET_WMS = "https://bhuvan.nrsc.gov.in/nhpgs/nhp_evapotranspiration/wms"
ET_WORKSPACE = "nhp_evapotranspiration"
ET_MONTHLY_PREFIX = "AET_SNPP_N_EB_MN_"
ET_FIRST_MONTH = "2015-03"
# Raster codes from the layer's SLD
ET_CLOUD = 65534
ET_NODATA = 65535
MAX_SERIES_MONTHS = 180
TIMEOUT = httpx.Timeout(30.0, connect=10.0)
NO_STORE = {"Cache-Control": "no-store"}

router = APIRouter(prefix="/fwa-api/hydro")


def _parse_month(raw: str) -> datetime.date:
    try:
        return datetime.datetime.strptime(raw, "%Y-%m").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="month must be YYYY-MM")


def _shift(month: datetime.date, delta: int) -> datetime.date:
    idx = month.year * 12 + month.month - 1 + delta
    return datetime.date(idx // 12, idx % 12 + 1, 1)


def _check_point(lat: float, lng: float) -> None:
    if not (6 <= lat <= 38 and 68 <= lng <= 98):
        raise HTTPException(status_code=400, detail="point must be inside India")


async def _et_value(client: httpx.AsyncClient, month: datetime.date, lat: float, lng: float) -> dict:
    layer = f"{ET_WORKSPACE}:{ET_MONTHLY_PREFIX}{month:%Y%m}"
    d = 0.005
    params = {
        "SERVICE": "WMS",
        "VERSION": "1.1.1",
        "REQUEST": "GetFeatureInfo",
        "LAYERS": layer,
        "QUERY_LAYERS": layer,
        "STYLES": "",
        "SRS": "EPSG:4326",
        "BBOX": f"{lng - d},{lat - d},{lng + d},{lat + d}",
        "WIDTH": 3,
        "HEIGHT": 3,
        "X": 1,
        "Y": 1,
        "INFO_FORMAT": "application/json",
    }
    out = {"month": f"{month:%Y-%m}", "value": None, "status": "error"}
    try:
        resp = await client.get(ET_WMS, params=params)
    except httpx.HTTPError:
        return out
    if "LayerNotDefined" in resp.text:
        out["status"] = "missing"
        return out
    try:
        features = resp.json().get("features") or []
    except ValueError:
        return out
    raw = features[0].get("properties", {}).get("GRAY_INDEX") if features else None
    if raw is None:
        out["status"] = "nodata"
    elif raw == ET_CLOUD:
        out["status"] = "cloud"
    elif raw >= ET_NODATA or raw <= 0:
        out["status"] = "nodata"
    else:
        out["status"] = "ok"
        out["value"] = round(float(raw), 3)
    return out


@router.get("/et/latest")
async def et_latest():
    """Most recent monthly ET layer, probed backwards from the current month."""
    month = datetime.date.today().replace(day=1)
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        for _ in range(8):
            res = await _et_value(client, month, 16.2, 77.1)
            if res["status"] not in ("missing", "error"):
                return JSONResponse(
                    {"first": ET_FIRST_MONTH, "latest": f"{month:%Y-%m}"}, headers=NO_STORE
                )
            month = _shift(month, -1)
    raise HTTPException(status_code=502, detail="No recent ET layer found on Bhuvan")


@router.get("/et/value")
async def et_value(lat: float, lng: float, month: str):
    _check_point(lat, lng)
    m = _parse_month(month)
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        res = await _et_value(client, m, lat, lng)
    return JSONResponse(res, headers=NO_STORE)


@router.get("/et/series")
async def et_series(lat: float, lng: float, start: str, end: Optional[str] = Query(None)):
    _check_point(lat, lng)
    first = _parse_month(start)
    last = _parse_month(end) if end else datetime.date.today().replace(day=1)
    if last < first:
        raise HTTPException(status_code=400, detail="end must not be before start")
    months = []
    m = first
    while m <= last and len(months) < MAX_SERIES_MONTHS:
        months.append(m)
        m = _shift(m, 1)

    sem = asyncio.Semaphore(8)
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:

        async def one(month: datetime.date) -> dict:
            async with sem:
                return await _et_value(client, month, lat, lng)

        series = await asyncio.gather(*(one(mm) for mm in months))

    # Trailing months that aren't published yet are noise, not gaps
    while series and series[-1]["status"] == "missing":
        series.pop()
    return JSONResponse({"lat": lat, "lng": lng, "series": series}, headers=NO_STORE)
