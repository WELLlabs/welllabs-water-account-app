"""Build api/data/crop_yields.json: crop yields (quintals per hectare) by district, state and India.

Sources, newest first:
  1. DES district-wise statistics via UPAg (Unified Portal for Agricultural Statistics), as hosted
     by India Data Portal (CKAN resource 6f70d961-3a4f-4caa-b08f-f72f708791e1): 2013-14 to
     2024-25, area in ha, production in tonnes (cotton as lint). The last --upag-years crop
     years are used.
  2. The older DES copy on data.gov.in (resource 35be999b-0208-4354-b557-f6ca9a5355de), which
     stops at 2015. It only fills a district, state or crop that UPAg lacks (chillies, mostly).

Yield for a crop-year is total production over total area across seasons; the table keeps the
median over the years used, and the yearly figures behind it.

Units follow the explorer's mandi prices (Agmarknet, ₹ per quintal of the traded produce):
  • Cotton is reported in bales of 170 kg lint; mandis trade kapas (seed cotton), so lint is
    divided by a 34 % ginning out-turn.
  • Rice is reported as milled rice; mandis trade paddy, so it is divided by a 67 % out-turn.
    States that report "Paddy" directly are used as they are.

Run with DATA_GOV_API_KEY in the environment (or .env). Without it the public sample key is
used, which returns 10 rows per request: slow, but it works.

    api/.venv/bin/python scripts/build_crop_yields.py [--years 2013 2014 2015]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import statistics
import sys
import time
from collections import defaultdict
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

RESOURCE = "35be999b-0208-4354-b557-f6ca9a5355de"
UPAG_RESOURCE = "6f70d961-3a4f-4caa-b08f-f72f708791e1"
UPAG_SQL = "https://ckandev.indiadataportal.com/api/3/action/datastore_search_sql"
UPAG_YEARS = 5
API = f"https://api.data.gov.in/resource/{RESOURCE}"
SAMPLE_KEY = "579b464db66ec23bdd000001cdd3946e44ce4aad7209ff7b23ac571b"
OUT = ROOT / "api" / "data" / "crop_yields.json"
# One file per (crop, year) fetched, so a rerun after an outage resumes where it stopped
PARTS = ROOT / ".cache" / "crop_yields"

LINT_BALE_KG = 170
GINNING_OUTTURN = 0.34
MILLING_OUTTURN = 0.67

# Explorer crop label (Google ALU) → DES crop names and a factor from DES production units to
# quintals of mandi produce: tonnes × 10 = quintals.
CROPS: dict[str, list[tuple[str, float]]] = {
    "Cotton": [("Cotton(lint)", LINT_BALE_KG / 100 / GINNING_OUTTURN)],
    "Corn": [("Maize", 10)],
    "Sorghum": [("Jowar", 10)],
    "Rice": [("Rice", 10 / MILLING_OUTTURN), ("Paddy", 10)],
    "Gram": [("Gram", 10)],
    "Chilli": [("Dry chillies", 10)],
    "Groundnut": [("Groundnut", 10)],
    "Bajra": [("Bajra", 10)],
    "Sugarcane": [("Sugarcane", 10)],
    "Mustard": [("Rapeseed &Mustard", 10)],
    "Wheat": [("Wheat", 10)],
    "Soybeans": [("Soyabean", 10)],
}


# Explorer crop label → UPAg crop name and a factor from tonnes to quintals of mandi produce
UPAG_CROPS: dict[str, tuple[str, float]] = {
    "Cotton": ("Cotton", 10 / GINNING_OUTTURN),
    "Corn": ("Maize", 10),
    "Sorghum": ("Jowar", 10),
    "Rice": ("Rice", 10 / MILLING_OUTTURN),
    "Gram": ("Gram", 10),
    "Groundnut": ("Groundnut", 10),
    "Bajra": ("Bajra", 10),
    "Sugarcane": ("Sugarcane", 10),
    "Mustard": ("Rapeseed & Mustard", 10),
    "Wheat": ("Wheat", 10),
    "Soybeans": ("Soybean", 10),
}


def norm(name: str) -> str:
    return re.sub(r"[^a-z]", "", (name or "").lower())


class Fetcher:
    def __init__(self, key: str, concurrency: int):
        self.key = key
        self.page = 1000 if key != SAMPLE_KEY else 10
        self.sem = asyncio.Semaphore(concurrency)
        # data.gov.in's proxy stalls the default "python-httpx" client (502 after 60 s)
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(60, connect=15),
            headers={"User-Agent": "Mozilla/5.0 (compatible; MandiPriceClient/1.0)", "Accept": "application/json"},
        )
        self.requests = 0

    async def get(self, params: dict) -> dict:
        for attempt in range(10):
            async with self.sem:
                try:
                    r = await self.client.get(API, params={"api-key": self.key, "format": "json", **params})
                    self.requests += 1
                    if r.status_code == 200:
                        return r.json()
                    err = f"HTTP {r.status_code}"
                except (httpx.HTTPError, ValueError) as e:
                    err = str(e)
            await asyncio.sleep(min(60, 5 * (attempt + 1)))
        raise RuntimeError(f"{params}: {err}")

    async def rows(self, crop: str, year: int) -> list[dict]:
        part = PARTS / f"{norm(crop)}_{year}.json"
        if part.is_file():
            return json.loads(part.read_text())
        out = await self._rows(crop, year)
        PARTS.mkdir(parents=True, exist_ok=True)
        part.write_text(json.dumps(out))
        return out

    async def _rows(self, crop: str, year: int) -> list[dict]:
        base = {"filters[crop]": crop, "filters[crop_year]": str(year), "limit": str(self.page)}
        first = await self.get({**base, "offset": "0"})
        out = list(first.get("records") or [])
        total = int(first.get("total") or 0)
        rest = await asyncio.gather(
            *(self.get({**base, "offset": str(o)}) for o in range(self.page, total, self.page))
        )
        for d in rest:
            out.extend(d.get("records") or [])
        return out


def yields(rows: list[tuple[str, str, object, float, float]]) -> tuple[dict, dict]:
    """rows: (state, district, year, area ha, production quintals) → medians by level, and the
    yearly [year, area ha, production q] behind each median so the app can show the working."""
    acc: dict[str, dict[tuple, list[float]]] = {"district": defaultdict(lambda: [0.0, 0.0]),
                                                 "state": defaultdict(lambda: [0.0, 0.0]),
                                                 "india": defaultdict(lambda: [0.0, 0.0])}
    for state, district, year, area, prod in rows:
        for level, key in (("district", (state, district, year)), ("state", (state, year)), ("india", (year,))):
            a = acc[level][key]
            a[0] += area
            a[1] += prod
    out: dict[str, dict] = {}
    series: dict[str, dict] = {}
    for level, groups in acc.items():
        per: dict[tuple, list[float]] = defaultdict(list)
        yearly: dict[tuple, list[list]] = defaultdict(list)
        for key, (area, prod) in sorted(groups.items(), key=lambda kv: str(kv[0][-1])):
            if area > 0 and prod > 0:
                per[key[:-1]].append(prod / area)
                yearly[key[:-1]].append([key[-1], round(area), round(prod)])
        out[level] = {k: round(statistics.median(v), 1) for k, v in per.items()}
        series[level] = dict(yearly)
    return out, series


async def upag_rows(client: httpx.AsyncClient, years: int) -> tuple[list[str], dict[str, list]]:
    """Newest `years` crop years from UPAg → (years, label → rows for yields()), cached in PARTS."""
    PARTS.mkdir(parents=True, exist_ok=True)

    async def sql(q: str) -> list[dict]:
        err = ""
        for attempt in range(6):
            try:
                r = await client.get(UPAG_SQL, params={"sql": q}, timeout=180)
                if r.status_code == 200:
                    return r.json()["result"]["records"]
                err = f"HTTP {r.status_code}"
            except (httpx.HTTPError, ValueError, KeyError) as e:
                err = type(e).__name__
            await asyncio.sleep(5 * (attempt + 1))
        raise RuntimeError(f"UPAg: {err}")

    have = sorted(r["year"] for r in await sql(f'SELECT DISTINCT year FROM "{UPAG_RESOURCE}"'))
    use = have[-years:]
    names = ", ".join(f"'{n}'" for n, _ in UPAG_CROPS.values())
    by_label: dict[str, list] = defaultdict(list)
    label_of = {n: (label, f) for label, (n, f) in UPAG_CROPS.items()}
    for year in use:
        part = PARTS / f"upag_{year}.json"
        if part.is_file():
            recs = json.loads(part.read_text())
        else:
            recs = await sql(
                f'SELECT state_name, district_name, crop_name, sum(area) a, sum(production) p FROM "{UPAG_RESOURCE}" '
                f"WHERE year = '{year}' AND crop_name IN ({names}) GROUP BY state_name, district_name, crop_name"
            )
            part.write_text(json.dumps(recs))
        label_year = f"{year[:4]}–{year[-2:]}"
        for r in recs:
            label, factor = label_of[r["crop_name"]]
            try:
                area, prod = float(r["a"] or 0), float(r["p"] or 0)
            except (TypeError, ValueError):
                continue
            by_label[label].append((r["state_name"].strip(), r["district_name"].strip(), label_year, area, prod * factor))
        print(f"  UPAg {year}: {len(recs)} district-crop rows", flush=True)
    return [f"{y[:4]}–{y[-2:]}" for y in use], by_label


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", type=int, nargs="+", default=[2013, 2014, 2015])
    ap.add_argument("--concurrency", type=int, default=4)
    ap.add_argument("--upag-years", type=int, default=UPAG_YEARS, help="newest UPAg crop years to use; 0 = DES only")
    args = ap.parse_args()

    key = (os.environ.get("DATA_GOV_API_KEY") or os.environ.get("DATA_GOV_IN_API_KEY") or "").strip() or SAMPLE_KEY
    f = Fetcher(key, args.concurrency)
    print(f"{'own key' if key != SAMPLE_KEY else 'sample key (10 rows per request)'}; years {args.years}", flush=True)
    t0 = time.time()

    table: dict[str, dict] = {"districts": defaultdict(dict), "states": defaultdict(dict), "india": {}}
    # Same keys, crop → [[year, area ha, production q], …]
    yearly: dict[str, dict] = {"districts": defaultdict(dict), "states": defaultdict(dict), "india": {}}
    names: dict[str, str] = {}
    for label, sources in CROPS.items():
        rows = []
        for des, factor in sources:
            for year in args.years:
                recs = await f.rows(des, year)
                for r in recs:
                    try:
                        area = float(r.get("area_") or 0)
                        prod = float(r.get("production_") or 0)
                    except (TypeError, ValueError):
                        continue
                    state, district = r["state_name"].strip(), r["district_name"].strip()
                    names[norm(state)] = state
                    rows.append((norm(state), norm(district), str(year), area, prod * factor))
                print(f"  {label:10} {des:18} {year}: {len(recs):5} rows  ({f.requests} requests, {time.time() - t0:.0f}s)", flush=True)
        y, ys = yields(rows)
        for (state, district), v in y["district"].items():
            table["districts"][f"{state}|{district}"][label] = v
            yearly["districts"][f"{state}|{district}"][label] = ys["district"][(state, district)]
        for (state,), v in y["state"].items():
            table["states"][state][label] = v
            yearly["states"][state][label] = ys["state"][(state,)]
        if () in y["india"]:
            table["india"][label] = y["india"][()]
            yearly["india"][label] = ys["india"][()]

    upag_years: list[str] = []
    if args.upag_years:
        upag_years, by_label = await upag_rows(f.client, args.upag_years)
        for label, raw in by_label.items():
            rows = []
            for state, district, year, area, prod in raw:
                names.setdefault(norm(state), state)
                rows.append((norm(state), norm(district), year, area, prod))
            y, ys = yields(rows)
            # Newer figures replace the 2011-15 ones wherever UPAg has them
            for (state, district), v in y["district"].items():
                table["districts"][f"{state}|{district}"][label] = v
                yearly["districts"][f"{state}|{district}"][label] = ys["district"][(state, district)]
            for (state,), v in y["state"].items():
                table["states"][state][label] = v
                yearly["states"][state][label] = ys["state"][(state,)]
            if () in y["india"]:
                table["india"][label] = y["india"][()]
                yearly["india"][label] = ys["india"][()]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {
                "source": (
                    f"DES district-wise crop statistics via UPAg ({upag_years[0]} to {upag_years[-1]}, India Data Portal), "
                    f"else the older DES copy on data.gov.in ({args.years[0]}–{args.years[-1]})"
                    if upag_years
                    else f"DES district-wise, season-wise crop production statistics (data.gov.in resource {RESOURCE})"
                ),
                "years": upag_years or args.years,
                "unit": "quintals per hectare of mandi produce (kapas for cotton, paddy for rice)",
                "notes": {
                    "Cotton": f"lint bales × {LINT_BALE_KG} kg ÷ {GINNING_OUTTURN} ginning out-turn",
                    "Rice": f"milled rice ÷ {MILLING_OUTTURN} out-turn, or paddy where reported",
                },
                "stateNames": names,
                "india": table["india"],
                "states": table["states"],
                "districts": table["districts"],
                "yearly": yearly,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )
    await f.client.aclose()
    print(f"wrote {OUT} · {len(table['districts'])} districts, {len(table['states'])} states, {f.requests} requests, {time.time() - t0:.0f}s")


if __name__ == "__main__":
    asyncio.run(main())
