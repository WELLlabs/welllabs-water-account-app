# Farm Water Accounting

A SvelteKit web app that visualizes farm plots from GeoPackage (`.gpkg`) files and calculates monthly water requirements based on crop type and sowing date.

## Features

- Upload a `.gpkg` file with `CROP_26_K` and `Sowing_Date` columns
- Match crops against `farm_water_budget.csv` for seasonal water budgets
- Interactive map with clickable farm polygons
- Side panel showing plot details and month-by-month water needs (mm)

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) and upload your GPKG file (e.g. `NRBC_D10_L1.gpkg`).

## Supported crops

Crops in the budget CSV: Paddy, Cotton, Groundnut, Pulses (Arhar), Pulses (Gram), Millets (Sorghum), Millets (Bajra), Sunflower, Seasame.

Plots with crops not in the budget (e.g. Chili) will show a warning when selected.

## Build

```bash
npm run build
npm run preview
```
