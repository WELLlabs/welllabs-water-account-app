"""Build the static S2 level-13 grid covering Raichur for T-Lab.

The boundary itself is served from S3 by api/layers.py; SRC must be the same file.

Run from the repo root with the API venv:
    api/.venv/bin/pip install s2sphere
    api/.venv/bin/python scripts/build_tlab_grid.py
"""

from __future__ import annotations

import json
from pathlib import Path

import geopandas as gpd
import s2sphere
from shapely.geometry import Polygon
from shapely.prepared import prep

ROOT = Path(__file__).resolve().parent.parent
# Local GIS inputs live under data-scraping/ (not served by the website).
SRC = ROOT / "data-scraping" / "Raichur_DT.geojson"
OUT_DIR = ROOT / "static" / "tlab"
S2_LEVEL = 13
COORD_DECIMALS = 5


def _write(path: Path, fc: dict) -> None:
    path.write_text(json.dumps(fc, separators=(",", ":")))
    print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size / 1024:.0f} KB)")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    gdf = gpd.read_file(SRC)
    if gdf.crs is None:
        gdf = gdf.set_crs(32643)
    gdf = gdf.to_crs(4326)
    district = gdf.geometry.union_all() if hasattr(gdf.geometry, "union_all") else gdf.geometry.unary_union

    minx, miny, maxx, maxy = district.bounds
    rect = s2sphere.LatLngRect.from_point_pair(
        s2sphere.LatLng.from_degrees(miny, minx),
        s2sphere.LatLng.from_degrees(maxy, maxx),
    )
    coverer = s2sphere.RegionCoverer()
    coverer.min_level = S2_LEVEL
    coverer.max_level = S2_LEVEL
    coverer.max_cells = 1_000_000
    cell_ids = coverer.get_covering(rect)

    district_prepared = prep(district)
    features = []
    for cid in cell_ids:
        cell = s2sphere.Cell(cid)
        ring = []
        for i in range(4):
            ll = s2sphere.LatLng.from_point(cell.get_vertex(i))
            ring.append((ll.lng().degrees, ll.lat().degrees))
        poly = Polygon(ring)
        if not district_prepared.intersects(poly):
            continue
        coords = [[round(x, COORD_DECIMALS), round(y, COORD_DECIMALS)] for x, y in ring]
        coords.append(coords[0])
        features.append(
            {
                "type": "Feature",
                "properties": {"id": cid.to_token(), "cellId": str(cid.id())},
                "geometry": {"type": "Polygon", "coordinates": [coords]},
            }
        )

    print(f"{len(cell_ids)} cells in bbox, {len(features)} intersect the district")
    _write(OUT_DIR / "raichur_s2_l13.geojson", {"type": "FeatureCollection", "features": features})


if __name__ == "__main__":
    main()
