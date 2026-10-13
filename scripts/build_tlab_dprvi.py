"""Build the T-Lab DpRVI overlay from the Sentinel-1 DpRVIc_YYYYMMDD.tif stack.

Each raster is warped to WGS84 on a shared grid and encoded as an 8-bit
grayscale PNG (0 = no data, 1..255 = DpRVI 0..1) so the browser can colour it
and read pixel values back. Also exports the TLBC D95 WUCS boundary.

Run from the repo root with a Python that has GDAL bindings + numpy:
    /opt/homebrew/bin/python3 scripts/build_tlab_dprvi.py
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np
from osgeo import gdal

gdal.UseExceptions()

ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / "S1_indices_5x5"
WUCS_ZIP = SRC_DIR / "Claude outputs" / "TLBC_D95_WUCS_Boundary.zip"
OUT_DIR = ROOT / "static" / "tlab" / "dprvi"
NAME_RE = re.compile(r"^DpRVIc_(\d{4})(\d{2})(\d{2})\.tif$")


def encode(values: np.ndarray, nodata: float | None) -> np.ndarray:
    valid = np.isfinite(values)
    if nodata is not None:
        valid &= values != nodata
    out = np.zeros(values.shape, dtype=np.uint8)
    out[valid] = np.rint(1 + np.clip(values[valid], 0, 1) * 254).astype(np.uint8)
    return out


def main() -> None:
    sources = sorted(p for p in SRC_DIR.iterdir() if NAME_RE.match(p.name))
    if not sources:
        raise SystemExit(f"No DpRVIc_*.tif files in {SRC_DIR}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in OUT_DIR.glob("*.png"):
        old.unlink()

    # Shared WGS84 grid from the first raster's footprint keeps every date aligned.
    ref = gdal.Warp("", str(sources[0]), format="MEM", dstSRS="EPSG:4326", resampleAlg="near")
    width, height = ref.RasterXSize, ref.RasterYSize
    gt = ref.GetGeoTransform()
    west, north = gt[0], gt[3]
    east, south = west + gt[1] * width, north + gt[5] * height
    ref = None

    dates = []
    for src in sources:
        y, m, d = NAME_RE.match(src.name).groups()
        iso = f"{y}-{m}-{d}"
        warped = gdal.Warp(
            "",
            str(src),
            format="MEM",
            dstSRS="EPSG:4326",
            outputBounds=(west, south, east, north),
            width=width,
            height=height,
            resampleAlg="near",
        )
        band = warped.GetRasterBand(1)
        values = band.ReadAsArray().astype(np.float32)
        encoded = encode(values, band.GetNoDataValue())

        mem = gdal.GetDriverByName("MEM").Create("", width, height, 1, gdal.GDT_Byte)
        mem.GetRasterBand(1).WriteArray(encoded)
        gdal.GetDriverByName("PNG").CreateCopy(str(OUT_DIR / f"{iso}.png"), mem, options=["ZLEVEL=9"])
        mem = None

        valid = encoded > 0
        vals = (encoded[valid].astype(np.float32) - 1) / 254
        dates.append(
            {
                "date": iso,
                "file": f"{iso}.png",
                "mean": round(float(vals.mean()), 4) if vals.size else None,
                "p10": round(float(np.percentile(vals, 10)), 4) if vals.size else None,
                "p90": round(float(np.percentile(vals, 90)), 4) if vals.size else None,
            }
        )
        print(f"{iso}: mean {dates[-1]['mean']}")

    manifest = {
        "index": "DpRVIc",
        "source": "Sentinel-1 dual-pol radar vegetation index (5x5 filtered)",
        "bounds": [[south, west], [north, east]],
        "width": width,
        "height": height,
        "encoding": {"nodata": 0, "min": 0, "max": 1, "offset": 1, "scale": 254},
        "dates": dates,
    }
    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=1))

    if WUCS_ZIP.exists():
        shp = f"/vsizip/{WUCS_ZIP}/TLBC_D95_WUCS_Boundary/WUCS_BOUNDARY.shp"
        gdal.VectorTranslate(
            str(OUT_DIR / "wucs_boundary.geojson"),
            shp,
            format="GeoJSON",
            dstSRS="EPSG:4326",
            layerCreationOptions=["COORDINATE_PRECISION=6", "RFC7946=YES"],
        )

    print(f"Wrote {len(dates)} dates to {OUT_DIR}")


if __name__ == "__main__":
    main()
