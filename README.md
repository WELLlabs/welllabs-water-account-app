# Farm Water Accounting

A SvelteKit web app that visualizes farm plots from GeoPackage (`.gpkg`) files and calculates monthly water requirements based on crop type, sowing date, and plot area.

## Features

- Upload a `.gpkg` file with `CROP_26_K`, `Sowing_Date`, and `Acre` columns
- Match crops against `farm_water_budget.csv` for seasonal water budgets
- Interactive map with clickable farm polygons
- Side panel showing plot details and month-by-month water needs (mm per acre and total for the plot)

## How the water budget is calculated

Each plot in the uploaded GeoPackage is matched to a row in `farm_water_budget.csv`. All monthly values in that CSV are **millimetres of water per acre**.

### Inputs from the GeoPackage

For each polygon, the app reads:

- **`CROP_26_K`** — crop name used to look up the budget
- **`Sowing_Date`** — when the crop was sown; the schedule starts from this month
- **`Acre`** — plot area used to scale per-acre values to the full plot

If `Acre` is missing or invalid, the app defaults to **1 acre**.

### Matching a crop to the budget

The budget CSV has one row per crop and season, with columns:

`Crop`, `Season`, `Start Month`, `End Month`, then monthly values from **June through May**.

For each plot:

1. The crop name is matched to the CSV (case-insensitive).
2. If a crop appears in more than one season (e.g. Paddy Kharif and Paddy Rabi), the app picks the season whose sowing window best matches the plot's `Sowing_Date`.
3. If no matching crop is found, the plot shows a warning instead of a schedule.

### Building the monthly schedule

Once a budget row is matched:

1. **Start month** — the calendar month of `Sowing_Date` (e.g. a May sowing starts in May).
2. **End month** — the `End Month` from the matched budget row (e.g. `Dec 15` for Cotton Kharif).
3. The app walks forward month by month from start to end, reading the corresponding value from the budget CSV.

For each month in that window:

```
Water per acre (mm) = value from farm_water_budget.csv
Total water required (mm)     = water per acre × plot acres
```

### Totals

At the bottom of the table:

```
Total water per acre (mm) = sum of monthly per-acre values
Total water required (mm) = total water per acre × plot acres
```

### Example

For **Cotton** sown on **25 May 2026** on a **2.5 acre** plot:

- The app matches **Cotton, Kharif** (June 1 – Dec 15).
- The schedule starts in **May 2026** and runs through **December 2026**.
- According to `farm_water_budget.csv`, June per acre: **447.83 mm**
- June Total water required (mm) for the given plot: **447.83 × 2.5 = 1,119.58 mm**

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) and upload your GPKG file.

## Supported crops

Crops in the budget CSV: Paddy, Cotton, Groundnut, Pulses (Arhar), Pulses (Gram), Millets (Sorghum), Millets (Bajra), Sunflower, Seasame.

Plots with crops not in the budget (e.g. Chili) will show a warning when selected.

## Build

```bash
npm run build
npm run preview
```
