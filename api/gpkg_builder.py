"""Build an OGR-compatible GeoPackage using geopandas / pyogrio."""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any

import geopandas as gpd
from shapely.geometry import shape

# Match MBTiles / XYZ tiles so QGIS overlays vectors on the basemap correctly.
EXPORT_CRS = "EPSG:3857"


def _features_to_gdf(features: list[dict[str, Any]], crs: str = "OGC:CRS84") -> gpd.GeoDataFrame:
    """Build a GeoDataFrame from GeoJSON features (GeoJSON is always lon/lat)."""
    rows: list[dict[str, Any]] = []
    geoms = []
    for feat in features:
        geom = feat.get("geometry")
        if geom is None:
            continue
        props = dict(feat.get("properties") or {})
        props.pop("fid", None)
        rows.append(props)
        geoms.append(shape(geom))

    if not rows:
        return gpd.GeoDataFrame(geometry=gpd.GeoSeries([], crs=crs), crs=crs)

    return gpd.GeoDataFrame(rows, geometry=geoms, crs=crs)


def _to_export_crs(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.crs is None:
        gdf = gdf.set_crs("OGC:CRS84")
    if str(gdf.crs) != EXPORT_CRS and gdf.crs.to_epsg() != 3857:
        return gdf.to_crs(EXPORT_CRS)
    return gdf


def _force_2d(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    try:
        gdf = gdf.copy()
        gdf["geometry"] = gdf.geometry.force_2d()
        return gdf
    except Exception:
        from shapely import force_2d as shapely_force_2d

        gdf = gdf.copy()
        gdf["geometry"] = gdf.geometry.apply(shapely_force_2d)
        return gdf


def build_plot_features(config: dict[str, Any]) -> list[dict[str, Any]]:
    kept = [c for c in (config.get("keptColumns") or []) if c.get("keep")]
    fields = config.get("fields") or []
    boundaries = config.get("boundaries") or {"features": []}

    out: list[dict[str, Any]] = []
    for feat in boundaries.get("features") or []:
        props: dict[str, Any] = {}
        src = feat.get("properties") or {}
        for col in kept:
            props[col["name"]] = src.get(col["name"])
        for field in fields:
            props[field["name"]] = None
        out.append(
            {
                "type": "Feature",
                "geometry": feat.get("geometry"),
                "properties": props,
            }
        )
    return out


def build_fic_features(mappings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    features: list[dict[str, Any]] = []
    for mapping in mappings or []:
        lateral = mapping.get("lateral", "")
        for fic in mapping.get("fics") or []:
            features.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [0.0, 0.0]},
                    "properties": {"lateral": lateral, "fic": fic},
                }
            )
    if not features:
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [0.0, 0.0]},
                "properties": {"lateral": "", "fic": ""},
            }
        )
    return features


def build_multiselect_features(fields: list[dict[str, Any]]) -> list[dict[str, Any]]:
    features: list[dict[str, Any]] = []
    for field in fields or []:
        if field.get("type") != "multiselect":
            continue
        for opt in field.get("options") or []:
            features.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [0.0, 0.0]},
                    "properties": {
                        "field_name": field.get("name", ""),
                        "value": opt.get("value", ""),
                        "label": opt.get("label", ""),
                    },
                }
            )
    if not features:
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [0.0, 0.0]},
                "properties": {"field_name": "", "value": "", "label": ""},
            }
        )
    return features


def write_gpkg(config: dict[str, Any], dest: Path) -> Path:
    """Write data.gpkg with farm plots + lookup tables. Returns dest path."""
    table_name = config.get("tableName") or "farm_plots"
    fields = config.get("fields") or []
    kept = [c for c in (config.get("keptColumns") or []) if c.get("keep")]

    plot_feats = build_plot_features(config)
    if not plot_feats:
        raise ValueError("No plot boundary features to export")

    plot_gdf = _features_to_gdf(plot_feats)
    plot_gdf = _force_2d(plot_gdf)
    # Reproject to Web Mercator so vectors share CRS with MBTiles / XYZ basemaps
    plot_gdf = _to_export_crs(plot_gdf)

    for col in kept:
        if col["name"] not in plot_gdf.columns:
            plot_gdf[col["name"]] = None
    for field in fields:
        name = field["name"]
        if name not in plot_gdf.columns:
            plot_gdf[name] = None

    ordered = [c["name"] for c in kept] + [f["name"] for f in fields]
    ordered = [c for c in ordered if c in plot_gdf.columns]
    extras = [c for c in plot_gdf.columns if c not in ordered and c != "geometry"]
    plot_gdf = plot_gdf[ordered + extras + ["geometry"]]

    if dest.exists():
        dest.unlink()

    plot_gdf.to_file(dest, layer=table_name, driver="GPKG")

    fic_gdf = _to_export_crs(_force_2d(_features_to_gdf(build_fic_features(config.get("ficMappings") or []))))
    fic_gdf.to_file(dest, layer="fic_lookup", driver="GPKG", mode="a")

    ms_gdf = _to_export_crs(_force_2d(_features_to_gdf(build_multiselect_features(fields))))
    ms_gdf.to_file(dest, layer="multiselect_opts", driver="GPKG", mode="a")

    return dest


def write_gpkg_bytes(config: dict[str, Any]) -> bytes:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "data.gpkg"
        write_gpkg(config, path)
        return path.read_bytes()
