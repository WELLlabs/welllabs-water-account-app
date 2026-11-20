"""Mandi prices and crop yields for a region, for the explorer's market revenue layer.

Revenue per crop is area × yield × price, computed in the browser from the Google ALU crop
areas it already has. This module supplies, per crop:

  • price: the median Agmarknet modal price (₹ per quintal) over the last PRICE_WINDOW_DAYS,
    from mandis in the region's districts, else its state, else all of India. A background
    collector copies these reports from data.gov.in "Variety-wise Daily Market Prices Data of
    Commodity" (updated daily) and keeps them on disk and in S3.
  • yield: quintals per hectare from api/data/crop_yields.json (DES district statistics, built
    by scripts/build_crop_yields.py), for the region's main district, else its state, else India.

Set DATA_GOV_API_KEY; without it the public sample key is used, which returns 10 rows per
request, so prices come from far fewer mandi reports.
"""

from __future__ import annotations

import asyncio
import datetime
import json
import logging
import os
import re
import statistics
import time
from pathlib import Path
from typing import Any, Optional

import httpx
import pyogrio
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from shapely.prepared import prep
from shapely.validation import make_valid

from .agri import _area_km2, _region_shape
from .boundaries import DISTRICTS, STATES
from .layers import BUCKET, _s3

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

log = logging.getLogger(__name__)

router = APIRouter(prefix="/fwa-api/market")

PRICES_URL = "https://api.data.gov.in/resource/35985678-0d79-46b4-9ed6-6f13308a1d24"
SAMPLE_KEY = "579b464db66ec23bdd000001cdd3946e44ce4aad7209ff7b23ac571b"
# data.gov.in's proxy stalls requests from the default "python-httpx" client (502 after 60 s)
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; MandiPriceClient/1.0)", "Accept": "application/json"}
API_KEY = (os.environ.get("DATA_GOV_API_KEY") or os.environ.get("DATA_GOV_IN_API_KEY") or "").strip() or SAMPLE_KEY
PAGE = 1000 if API_KEY != SAMPLE_KEY else 10
# Pages per (date, commodity): one is usually enough with a real key
MAX_PAGES = int(os.environ.get("MARKET_MAX_PAGES", "5" if API_KEY != SAMPLE_KEY else "30"))
PRICE_WINDOW_DAYS = int(os.environ.get("MARKET_PRICE_WINDOW_DAYS", "30"))
# District prices need this many mandi reports, else the state median is used
MIN_DISTRICT_REPORTS = 3
YIELDS_PATH = Path(__file__).resolve().parent / "data" / "crop_yields.json"
# Local copy of the mandi reports (also kept in S3 under MARKET_S3_PREFIX)
CACHE_DIR = Path(os.environ.get("MARKET_CACHE_DIR", "/tmp/welllabs-market"))

# Explorer crop label (Google ALU) → Agmarknet commodity names (Paddy was renamed in late 2025)
COMMODITIES: dict[str, list[str]] = {
    "Cotton": ["Cotton"],
    "Corn": ["Maize"],
    "Sorghum": ["Jowar(Sorghum)"],
    "Rice": ["Paddy(Common)", "Paddy(Dhan)(Common)"],
    "Gram": ["Bengal Gram(Gram)(Whole)"],
    "Chilli": ["Dry Chillies"],
    "Groundnut": ["Groundnut"],
    "Bajra": ["Bajra(Pearl Millet/Cumbu)"],
    "Sugarcane": ["Sugarcane"],
    "Mustard": ["Mustard"],
    "Wheat": ["Wheat"],
    "Soybeans": ["Soyabean"],
    # Crop water calculator crops that Google ALU does not map
    # Agmarknet renamed these in 2026; the old names stop in May
    "Tur": ["Red gram/Arhar/Tur(whole)", "Arhar(Tur/Red Gram)(Whole)"],
    "Ragi": ["Ragi(Finger Millet)"],
    "Sunflower": ["Sunflower/Sunflower Seed", "Sunflower"],
    "Sesame": ["Sesamum(Sesame,Gingelly,Til)"],
}

# Agmarknet and DES spell some states differently from the district boundaries
STATE_ALIASES = {
    "kerala": ["keralam"],
    "odisha": ["orissa"],
    "telangana": ["andhrapradesh"],
    "ladakh": ["jammuandkashmir"],
    "uttarakhand": ["uttaranchal"],
    "puducherry": ["pondicherry"],
    "dadraandnagarhaveli": ["thedadraandnagarhavelianddamananddiu"],
    "damananddiu": ["thedadraandnagarhavelianddamananddiu"],
}

# Renamed districts: new name → older spellings used in the DES statistics and some mandi reports
DISTRICT_ALIASES = {
    "ballari": ["bellary"], "belagavi": ["belgaum"], "vijayapura": ["bijapur"], "kalaburagi": ["gulbarga"],
    "mysuru": ["mysore"], "shivamogga": ["shimoga"], "tumakuru": ["tumkur"], "chikkamagaluru": ["chikmagalur"],
    "bengaluruurban": ["bangalore", "bangaloreurban"], "bengalururural": ["bangalorerural"],
    "dakshinakannada": ["dakshinkannad"], "uttarakannada": ["uttarkannad"], "chamarajanagar": ["chamrajnagar"],
    "kodagu": ["coorg"], "yadgir": ["yadagiri"], "gurugram": ["gurgaon"], "prayagraj": ["allahabad"],
    "ayodhya": ["faizabad"], "kheri": ["lakhimpurkheri"], "ahmednagar": ["ahmadnagar"],
    "chhatrapatisambhajinagar": ["aurangabad"], "dharashiv": ["osmanabad"], "nuh": ["mewat"],
    "sripottisriramulunellore": ["nellore", "spsnellore"], "ysrkadapa": ["kadapa", "cuddapah"],
    "kanchipuram": ["kancheepuram"], "thoothukudi": ["tuticorin"], "tiruchirappalli": ["tiruchirapalli", "trichy"],
}

# UPAg (newest crop statistics) spellings → names in the district boundaries and older sources
for _new, _old in {
    # Odisha uses Odia spellings in UPAg
    "subarnapur": ["sonepur"], "kandhamala": ["kandhamal"], "baragada": ["bargarh"], "debagada": ["deogarh"],
    "anugola": ["anugul", "angul"], "nayagada": ["nayagarh"], "kataka": ["cuttack"], "jajpur": ["jajapur"],
    "kendrapada": ["kendrapara"], "sundaragada": ["sundargarh"],
    "siaha": ["saiha"], "sribhumi": ["karimganj"],
    "mahrajganj": ["maharajganj"], "santkabirnagar": ["santkabeernagar"], "shrawasti": ["shravasti"],
    "uttardinajpur": ["dinajpuruttar"], "dakshindinajpur": ["dinajpurdakshin"], "malda": ["maldah"],
    "northparganas": ["paraganasnorth"], "southparganas": ["paraganassouth"],
    "purbamedinipur": ["medinipureast"], "paschimmedinipur": ["medinipurwest"],
    "gaurelapendramarwahi": ["gaurellapendramarwahi"], "kabeerdham": ["kabirdham"],
    "balodabazarbhatapara": ["balodabazar"], "balrampurramanujganj": ["balrampur"], "uttarbastarkanker": ["kanker"], "dakshinbastardantewada": ["dantewada"],
    "narsimhapur": ["narsinghpur"], "narmadapuram": ["hoshangabad"],
    "khandwaeastnimar": ["eastnimar", "khandwa"], "khargonewestnimar": ["khargone", "westnimar"],
    "charkhidadri": ["charkidadri"], "udhamsinghnagar": ["udamsinghnagar"],
    "lahaulandspiti": ["lahulampspiti", "lahulspiti", "lahaulspiti"], "ferozepur": ["firozepur"],
    "dahod": ["dohad"], "dangs": ["dang"], "ahilyanagar": ["ahmednagar", "ahmadnagar"],
    "warangal": ["warangalrural"], "hanumakonda": ["warangalurban"],
    "visakhapatnam": ["visakhapatanam"], "ysrkadapa": ["ysr", "kadapa", "cuddapah"], "ananthapuramu": ["anantapur"],
    "sripottisriramulunellore": ["spsrnellore", "spsnellore", "nellore"],
    "davanagere": ["davangere"], "chamarajanagar": ["chamarajanagara", "chamrajnagar"], "bengalurusouth": ["ramanagara"],
    "viluppuram": ["villupuram"], "thoothukkudi": ["thoothukudi", "tuticorin"], "puducherry": ["pondicherry"],
    # Sikkim renamed its districts after their headquarters
    "mangan": ["northdistrict"], "gangtok": ["eastdistrict"], "namchi": ["southdistrict"], "gyalshing": ["westdistrict"],
    # Manipur districts carved out after 2016, which UPAg still reports under the parent district
    "ukhrul": ["kamjong"], "senapati": ["kangpokpi"], "thoubal": ["kakching"], "chandel": ["tengnoupal"],
    "imphaleast": ["jiribam"], "churachandpur": ["pherzawl"], "tamenglong": ["noney"],
}.items():
    DISTRICT_ALIASES[_new] = list(dict.fromkeys([*DISTRICT_ALIASES.get(_new, []), *_old]))


def norm(name: Any) -> str:
    return re.sub(r"[^a-z]", "", str(name or "").lower())


def _variants(name: str, aliases: dict[str, list[str]]) -> list[str]:
    """The name and its other spellings, both ways: boundaries and sources mix old and new names."""
    n = norm(name)
    out = [n, *aliases.get(n, [])]
    for new, old in aliases.items():
        if n in old:
            out += [new, *old]
    return list(dict.fromkeys(out))


# ── Yields ───────────────────────────────────────────────────────────────────

_yields: Optional[dict] = None
_yields_mtime = 0.0


def _yield_table() -> Optional[dict]:
    global _yields, _yields_mtime
    try:
        mtime = YIELDS_PATH.stat().st_mtime
    except FileNotFoundError:
        return None
    if _yields is None or mtime != _yields_mtime:
        _yields = json.loads(YIELDS_PATH.read_text())
        _yields_mtime = mtime
    return _yields


def _yield(table: Optional[dict], crop: str, state: str, district: str) -> Optional[dict]:
    if not table:
        return None
    years = table.get("years")
    yearly = table.get("yearly") or {}

    def found(v: float, level: str, place: str, series: Optional[list]) -> dict:
        # series: [[year, area ha, production q], …] behind the median
        return {"value": v, "level": level, "place": place, "years": years, "series": series or []}

    # A district can sit under its old and new name (older DES vs UPAg); use the newest figures
    best = None
    for s in _variants(state, STATE_ALIASES):
        for d in _variants(district, DISTRICT_ALIASES):
            key = f"{s}|{d}"
            v = (table["districts"].get(key) or {}).get(crop)
            if not v:
                continue
            series = (yearly.get("districts", {}).get(key) or {}).get(crop) or []
            latest = str(series[-1][0]) if series else ""
            if best is None or latest > best[0]:
                best = (latest, v, series)
    if best:
        return found(best[1], "district", district, best[2])
    for s in _variants(state, STATE_ALIASES):
        v = (table["states"].get(s) or {}).get(crop)
        if v:
            return found(v, "state", state, (yearly.get("states", {}).get(s) or {}).get(crop))
    v = table["india"].get(crop)
    return found(v, "india", "India", yearly.get("india", {}).get(crop)) if v else None


# ── Prices: a local copy of the last PRICE_WINDOW_DAYS of mandi reports ──────
#
# data.gov.in is slow and often times out on filtered, sorted queries, so regions never query it
# directly. A background collector keeps one file per arrival date with the reports of every
# commodity above, across India: one small request per (date, commodity), retried until it
# succeeds. Region prices are medians over that copy, so they are instant and survive outages.

DAYS_DIR = CACHE_DIR / "days"
S3_PREFIX = os.environ.get("MARKET_S3_PREFIX", "market/agmarknet/")
# Reports for the last few days keep arriving, so those dates are fetched again
REFRESH_DAYS = 3
REFRESH_EVERY = 3 * 3600
RETRY_EVERY = 10 * 60
COLLECT_CONCURRENCY = int(os.environ.get("MARKET_COLLECT_CONCURRENCY", "2"))
ALL_COMMODITIES = sorted({c for names in COMMODITIES.values() for c in names})

_http: Optional[httpx.AsyncClient] = None
# date → {"commodities": {name: [[state, district, market, modal ₹/q], …]}, "fetchedAt": {name: epoch}}
_days: dict[datetime.date, dict] = {}
_collector: Optional[asyncio.Task] = None
_status: dict[str, Any] = {"running": False, "lastRun": None, "lastError": None, "requests": 0}


def _client() -> httpx.AsyncClient:
    global _http
    if _http is None:
        _http = httpx.AsyncClient(timeout=httpx.Timeout(90, connect=15), headers=HEADERS)
    return _http


def _ddmmyyyy(d: datetime.date) -> str:
    return d.strftime("%d/%m/%Y")


async def _page(params: dict) -> dict:
    last = ""
    for attempt in range(4):
        try:
            _status["requests"] += 1
            r = await _client().get(PRICES_URL, params={"api-key": API_KEY, "format": "json", "limit": str(PAGE), **params})
            if r.status_code == 200:
                return r.json()
            last = f"HTTP {r.status_code}"
        except (httpx.HTTPError, ValueError) as e:
            last = type(e).__name__
        await asyncio.sleep(5 * (attempt + 1))
    raise RuntimeError(f"data.gov.in: {last}")


async def _fetch_day(day: datetime.date, commodity: str) -> list[list]:
    rows: list[list] = []
    for page in range(MAX_PAGES):
        body = await _page({"filters[Arrival_Date]": _ddmmyyyy(day), "filters[Commodity]": commodity, "offset": str(page * PAGE)})
        recs = body.get("records") or []
        for r in recs:
            try:
                price = float(r.get("Modal_Price") or 0)
            except (TypeError, ValueError):
                continue
            if price > 0:
                rows.append([r.get("State") or "", r.get("District") or "", r.get("Market") or "", price])
        if len(recs) < PAGE:
            break
    return rows


def _day_path(day: datetime.date) -> Path:
    return DAYS_DIR / f"{day.isoformat()}.json"


def _save_day(day: datetime.date) -> None:
    body = json.dumps(_days[day], separators=(",", ":"))
    try:
        DAYS_DIR.mkdir(parents=True, exist_ok=True)
        tmp = _day_path(day).with_suffix(".tmp")
        tmp.write_text(body)
        tmp.replace(_day_path(day))
    except OSError as e:
        log.warning("Could not write mandi prices for %s: %s", day, e)
    if BUCKET:
        try:
            _s3().put_object(Bucket=BUCKET, Key=f"{S3_PREFIX}{day.isoformat()}.json", Body=body.encode(), ContentType="application/json")
        except Exception as e:
            log.warning("Could not copy mandi prices for %s to S3: %s", day, e)


def _load_days() -> None:
    """Disk first, then S3 for dates the disk does not have (a fresh server after a deploy)."""
    cutoff = datetime.date.today() - datetime.timedelta(days=PRICE_WINDOW_DAYS)
    if DAYS_DIR.is_dir():
        for f in DAYS_DIR.glob("*.json"):
            try:
                day = datetime.date.fromisoformat(f.stem)
                if day >= cutoff:
                    _days[day] = json.loads(f.read_text())
            except (ValueError, OSError):
                continue
    if not BUCKET:
        return
    try:
        s3 = _s3()
        listed = s3.list_objects_v2(Bucket=BUCKET, Prefix=S3_PREFIX).get("Contents") or []
        for obj in listed:
            stem = obj["Key"][len(S3_PREFIX):].removesuffix(".json")
            try:
                day = datetime.date.fromisoformat(stem)
            except ValueError:
                continue
            if day < cutoff or day in _days:
                continue
            _days[day] = json.loads(s3.get_object(Bucket=BUCKET, Key=obj["Key"])["Body"].read())
            DAYS_DIR.mkdir(parents=True, exist_ok=True)
            _day_path(day).write_text(json.dumps(_days[day], separators=(",", ":")))
    except Exception as e:
        log.warning("Could not read mandi prices from S3: %s", e)


def _due(day: datetime.date, commodity: str, today: datetime.date) -> bool:
    entry = _days.get(day)
    fetched = (entry or {}).get("fetchedAt", {}).get(commodity)
    if fetched is None:
        return True
    return (today - day).days < REFRESH_DAYS and time.time() - fetched > REFRESH_EVERY


async def _collect_once() -> int:
    """Fetch every (date, commodity) that is missing or due; returns how many failed."""
    today = datetime.date.today()
    days = [today - datetime.timedelta(days=i) for i in range(PRICE_WINDOW_DAYS + 1)]
    for old in [d for d in _days if d < days[-1]]:
        _days.pop(old, None)
        try:
            _day_path(old).unlink()
        except OSError:
            pass
    jobs = [(d, c) for d in days for c in ALL_COMMODITIES if _due(d, c, today)]
    sem = asyncio.Semaphore(COLLECT_CONCURRENCY)
    failed = 0

    async def run(day: datetime.date, commodity: str) -> None:
        nonlocal failed
        async with sem:
            try:
                rows = await _fetch_day(day, commodity)
            except Exception as e:
                failed += 1
                _status["lastError"] = f"{day} {commodity}: {e}"
                return
            entry = _days.setdefault(day, {"commodities": {}, "fetchedAt": {}})
            entry["commodities"][commodity] = rows
            entry["fetchedAt"][commodity] = time.time()
            _save_day(day)

    await asyncio.gather(*(run(d, c) for d, c in jobs))
    return failed


async def _collect_forever() -> None:
    await asyncio.to_thread(_load_days)
    while True:
        _status["running"] = True
        try:
            failed = await _collect_once()
        except Exception as e:
            log.exception("Mandi price collector failed")
            _status["lastError"] = str(e)
            failed = 1
        _status["running"] = False
        if not failed:
            _status["lastError"] = None
        _status["lastRun"] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
        await asyncio.sleep(RETRY_EVERY if failed else REFRESH_EVERY)


def start_collector() -> None:
    """Started with the app; one collector per process (the API runs a single worker)."""
    global _collector
    if os.environ.get("MARKET_COLLECTOR", "1") == "0":
        return
    if _collector is None or _collector.done():
        _collector = asyncio.get_running_loop().create_task(_collect_forever())


def _coverage() -> dict:
    today = datetime.date.today()
    window = [today - datetime.timedelta(days=i) for i in range(PRICE_WINDOW_DAYS + 1)]
    have = [d for d in window if len((_days.get(d) or {}).get("commodities", {})) == len(ALL_COMMODITIES)]
    partial = [d for d in window if d in _days and d not in have]
    return {
        "days": len(have),
        "partialDays": len(partial),
        "windowDays": PRICE_WINDOW_DAYS,
        "from": min(have).isoformat() if have else None,
        "to": max(have).isoformat() if have else None,
        "collecting": bool(_status["running"]),
        # An error only matters while some date is still missing
        "lastError": _status["lastError"] if len(have) < len(window) else None,
    }


def _reports(names: list[str]) -> list[tuple[datetime.date, str, str, str, float]]:
    cutoff = datetime.date.today() - datetime.timedelta(days=PRICE_WINDOW_DAYS)
    out = []
    for day, entry in _days.items():
        if day < cutoff:
            continue
        for c in names:
            for state, district, market, price in entry["commodities"].get(c, []):
                out.append((day, state, district, market, price))
    return out


def _summary(rows: list, level: str, place: str) -> dict:
    return {
        "value": round(statistics.median(r[4] for r in rows)),
        "level": level,
        "place": place,
        "reports": len(rows),
        "markets": len({(r[2], r[3]) for r in rows}),
        "from": min(r[0] for r in rows).isoformat(),
        "to": max(r[0] for r in rows).isoformat(),
    }


def _price(crop: str, state: str, districts: list[str]) -> Optional[dict]:
    names = COMMODITIES.get(crop)
    if not names:
        return None
    rows = _reports(names)
    if not rows:
        return None
    states = set(_variants(state, STATE_ALIASES))
    wanted = {v for d in districts for v in _variants(d, DISTRICT_ALIASES)}
    in_state = [r for r in rows if norm(r[1]) in states]
    local = [r for r in in_state if norm(r[2]) in wanted]
    if len(local) >= MIN_DISTRICT_REPORTS:
        return _summary(local, "district", ", ".join(districts))
    if in_state:
        return _summary(in_state, "state", state)
    return _summary(rows, "india", "India")


# ── Region → districts ───────────────────────────────────────────────────────


def _districts(region) -> list[dict]:
    """Districts the region overlaps, largest share first."""
    with DISTRICTS.lock:
        DISTRICTS._refresh()
        path = DISTRICTS.path
    if path is None:
        return []
    gdf = pyogrio.read_dataframe(path, columns=["District", "State"], bbox=tuple(region.bounds))
    total = region.area or 1
    pr = prep(region)
    out = []
    for _, row in gdf.iterrows():
        g = row.geometry
        if g is None or not pr.intersects(g):
            continue
        share = make_valid(g).intersection(region).area / total
        if share > 0.001:
            out.append({"district": str(row.District), "state": STATES.get(str(row.State).upper(), str(row.State)), "share": round(share, 3)})
    return sorted(out, key=lambda d: -d["share"])


class MarketRequest(BaseModel):
    geometry: dict[str, Any]


@router.post("/region")
async def market_region(req: MarketRequest):
    """Price and yield per crop for a boundary: the inputs of the market revenue layer."""
    region = _region_shape(req.geometry)
    districts = await asyncio.to_thread(_districts, region)
    if not districts:
        raise HTTPException(status_code=404, detail="This boundary is outside India's districts, so no mandi prices apply.")
    main = districts[0]
    state = main["state"]
    names = [d["district"] for d in districts if d["state"] == state]
    table = _yield_table()

    start_collector()
    crops = list(COMMODITIES)
    prices = [_price(c, state, names) for c in crops]
    coverage = _coverage()
    return Response(
        json.dumps(
            {
                "asOf": datetime.date.today().isoformat(),
                "windowDays": PRICE_WINDOW_DAYS,
                "state": state,
                "districts": districts,
                "areaKm2": round(_area_km2(region), 1),
                "sampleKey": API_KEY == SAMPLE_KEY,
                "yieldSource": table.get("source") if table else None,
                "yieldYears": table.get("years") if table else None,
                "coverage": coverage,
                "crops": {
                    c: {
                        "commodity": " / ".join(COMMODITIES[c]),
                        "price": p,
                        "yield": _yield(table, c, state, main["district"]),
                    }
                    for c, p in zip(crops, prices)
                },
            }
        ),
        media_type="application/json",
        headers={"Cache-Control": "no-store"},
    )
