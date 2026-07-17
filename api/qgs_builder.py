"""Build a QGIS 3.34-compatible .qgs XML project string."""

from __future__ import annotations

import uuid
from typing import Any
from xml.sax.saxutils import escape


FIC_LOOKUP_TABLE = "fic_lookup"
MULTISELECT_OPTS_TABLE = "multiselect_opts"

# Web Mercator — same CRS as MBTiles / XYZ basemaps (avoids degree-vs-metre mismatch in QGIS)
SRS_3857 = """<spatialrefsys nativeFormat="Wkt">
          <wkt>PROJCRS["WGS 84 / Pseudo-Mercator",BASEGEOGCRS["WGS 84",DATUM["World Geodetic System 1984",ELLIPSOID["WGS 84",6378137,298.257223563,LENGTHUNIT["metre",1]]],PRIMEM["Greenwich",0,ANGLEUNIT["degree",0.0174532925199433]],ID["EPSG",4326]],CONVERSION["Popular Visualisation Pseudo-Mercator",METHOD["Popular Visualisation Pseudo Mercator",ID["EPSG",1024]],PARAMETER["Latitude of natural origin",0,ANGLEUNIT["degree",0.0174532925199433],ID["EPSG",8801]],PARAMETER["Longitude of natural origin",0,ANGLEUNIT["degree",0.0174532925199433],ID["EPSG",8802]],PARAMETER["False easting",0,LENGTHUNIT["metre",1],ID["EPSG",8806]],PARAMETER["False northing",0,LENGTHUNIT["metre",1],ID["EPSG",8807]]],CS[Cartesian,2],AXIS["easting (X)",east,ORDER[1],LENGTHUNIT["metre",1]],AXIS["northing (Y)",north,ORDER[2],LENGTHUNIT["metre",1]],USAGE[SCOPE["Web mapping and visualisation."],AREA["World."],BBOX[-85.06,-180,85.06,180]],ID["EPSG",3857]]</wkt>
          <proj4>+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs</proj4>
          <srsid>3857</srsid>
          <srid>3857</srid>
          <authid>EPSG:3857</authid>
          <description>WGS 84 / Pseudo-Mercator</description>
          <projectionacronym>merc</projectionacronym>
          <ellipsoidacronym>EPSG:7030</ellipsoidacronym>
          <geographicflag>false</geographicflag>
        </spatialrefsys>"""

SRS_4326 = SRS_3857


def esc(value: str) -> str:
    return escape(str(value), {'"': "&quot;"})


def create_layer_ids(basemap_count: int) -> dict[str, Any]:
    return {
        "plotsLayerId": str(uuid.uuid4()),
        "ficLookupLayerId": f"fic_lookup_layer_{uuid.uuid4().hex[:8]}",
        "multiselectOptsLayerId": f"multiselect_opts_layer_{uuid.uuid4().hex[:8]}",
        "basemapLayerIds": [str(uuid.uuid4()) for _ in range(basemap_count)],
    }


def basemap_qgs_info(bm: dict[str, Any]) -> tuple[str, str, str]:
    """Return (datasource, provider, display_name)."""
    if bm.get("requiresInternet", True):
        return (
            bm.get("qgsDatasource")
            or "type=xyz&url=https://tile.openstreetmap.org/{z}/{x}/{y}.png&zmax=19&zmin=0",
            "wms",
            bm.get("label") or "Basemap",
        )

    file_name = bm.get("fileName") or bm.get("label") or "basemap"
    # Files bundled inside the QGZ must use the attachment: prefix so QGIS
    # resolves them against the extracted archive directory (not Downloads/).
    return f"attachment:{file_name}", "gdal", file_name


def gpkg_datasource(layer_name: str) -> str:
    """Datasource for a layer inside the bundled data.gpkg."""
    return f"attachment:data.gpkg|layername={layer_name}"


def _extract_coords(geometry: dict[str, Any] | None) -> list[list[float]]:
    if not geometry:
        return []
    gtype = geometry.get("type")
    coords = geometry.get("coordinates")
    if gtype == "Point":
        return [coords]  # type: ignore
    if gtype in ("MultiPoint", "LineString"):
        return coords  # type: ignore
    if gtype in ("MultiLineString", "Polygon"):
        return [c for ring in coords for c in ring]  # type: ignore
    if gtype == "MultiPolygon":
        return [c for poly in coords for ring in poly for c in ring]  # type: ignore
    return []


def compute_extent(boundaries: dict[str, Any]) -> tuple[float, float, float, float]:
    """Return map canvas extent in EPSG:3857 (metres), matching exported GPKG CRS."""
    min_x = min_y = float("inf")
    max_x = max_y = float("-inf")
    for feat in boundaries.get("features") or []:
        for x, y, *_ in _extract_coords(feat.get("geometry")):
            min_x = min(min_x, x)
            min_y = min(min_y, y)
            max_x = max(max_x, x)
            max_y = max(max_y, y)
    if not (min_x < float("inf")):
        # Default around NRBC area in Web Mercator
        return 8544000.0, 1839000.0, 8546000.0, 1841000.0

    # GeoJSON coords are lon/lat — project to EPSG:3857 for the canvas
    try:
        from pyproj import Transformer

        to_3857 = Transformer.from_crs("OGC:CRS84", "EPSG:3857", always_xy=True)
        x0, y0 = to_3857.transform(min_x, min_y)
        x1, y1 = to_3857.transform(max_x, max_y)
        min_x, max_x = min(x0, x1), max(x0, x1)
        min_y, max_y = min(y0, y1), max(y0, y1)
    except Exception:
        pass

    pad_x = (max_x - min_x) * 0.1 or 100.0
    pad_y = (max_y - min_y) * 0.1 or 100.0
    return min_x - pad_x, min_y - pad_y, max_x + pad_x, max_y + pad_y


# ─── Widget builders ──────────────────────────────────────────────────────────


def build_value_map_config(options: list[dict[str, str]]) -> str:
    entries = "\n".join(
        f'              <Option name="{esc(o.get("label", ""))}" type="QString" value="{esc(o.get("value", ""))}"/>'
        for o in options
    )
    return f"""<config>
            <Option type="Map">
              <Option name="map" type="Map">
{entries}
              </Option>
            </Option>
          </config>"""


def build_text_edit_config(multiline: bool = False) -> str:
    return f"""<config>
            <Option type="Map">
              <Option name="IsMultiline" type="bool" value="{"true" if multiline else "false"}"/>
              <Option name="UseHtml" type="bool" value="false"/>
            </Option>
          </config>"""


def build_date_config() -> str:
    return """<config>
            <Option type="Map">
              <Option name="allow_null" type="bool" value="true"/>
              <Option name="calendar_popup" type="bool" value="true"/>
              <Option name="display_format" type="QString" value="yyyy-MM-dd"/>
              <Option name="field_format" type="QString" value="yyyy-MM-dd"/>
              <Option name="field_iso_format" type="bool" value="false"/>
            </Option>
          </config>"""


def build_boolean_config() -> str:
    return """<config>
            <Option type="Map">
              <Option name="CheckedState" type="int" value="2"/>
              <Option name="TextDisplayMethod" type="int" value="0"/>
              <Option name="UncheckedState" type="int" value="0"/>
            </Option>
          </config>"""


def build_attachment_config() -> str:
    return """<config>
            <Option type="Map">
              <Option name="DocumentViewer" type="int" value="0"/>
              <Option name="DocumentViewerHeight" type="int" value="0"/>
              <Option name="DocumentViewerWidth" type="int" value="0"/>
              <Option name="FileWidget" type="bool" value="true"/>
              <Option name="FileWidgetButton" type="bool" value="true"/>
              <Option name="FileWidgetFilter" type="QString" value="Images (*.jpg *.jpeg *.png)"/>
              <Option name="FullUrl" type="bool" value="false"/>
              <Option name="RelativeStorage" type="int" value="1"/>
              <Option name="StorageAuthConfigId" type="QString" value=""/>
              <Option name="StorageMode" type="int" value="0"/>
              <Option name="StorageType" type="QString" value=""/>
            </Option>
          </config>"""


def build_range_config(is_real: bool) -> str:
    t = "double" if is_real else "int"
    mx = "1e+12" if is_real else "2147483647"
    mn = "-1e+12" if is_real else "-2147483648"
    prec = "6" if is_real else "0"
    return f"""<config>
            <Option type="Map">
              <Option name="AllowNull" type="bool" value="true"/>
              <Option name="Max" type="{t}" value="{mx}"/>
              <Option name="Min" type="{t}" value="{mn}"/>
              <Option name="Precision" type="int" value="{prec}"/>
              <Option name="Step" type="{t}" value="1"/>
              <Option name="Style" type="QString" value="SpinBox"/>
            </Option>
          </config>"""


def build_value_relation_config(layer_id: str, filter_expr: str) -> str:
    return f"""<config>
            <Option type="Map">
              <Option name="AllowMulti" type="bool" value="false"/>
              <Option name="AllowNull" type="bool" value="true"/>
              <Option name="CompleterMatchFlags" type="int" value="2"/>
              <Option name="Description" type="QString" value=""/>
              <Option name="DisplayGroupName" type="bool" value="false"/>
              <Option name="FilterExpression" type="QString" value="{esc(filter_expr)}"/>
              <Option name="Group" type="QString" value=""/>
              <Option name="Key" type="QString" value="fic"/>
              <Option name="Layer" type="QString" value="{layer_id}"/>
              <Option name="LayerName" type="QString" value="{FIC_LOOKUP_TABLE}"/>
              <Option name="LayerSource" type="QString" value="attachment:data.gpkg|layername={FIC_LOOKUP_TABLE}"/>
              <Option name="LayerProviderName" type="QString" value="ogr"/>
              <Option name="NofColumns" type="int" value="1"/>
              <Option name="OrderByDescending" type="bool" value="false"/>
              <Option name="OrderByField" type="bool" value="false"/>
              <Option name="OrderByFieldName" type="QString" value=""/>
              <Option name="OrderByKey" type="bool" value="true"/>
              <Option name="OrderByValue" type="bool" value="false"/>
              <Option name="UseCompleter" type="bool" value="false"/>
              <Option name="Value" type="QString" value="fic"/>
            </Option>
          </config>"""


def build_multiselect_config(layer_id: str, field_name: str) -> str:
    filt = f"\"field_name\" = '{field_name}'"
    return f"""<config>
            <Option type="Map">
              <Option name="AllowMulti" type="bool" value="true"/>
              <Option name="AllowNull" type="bool" value="true"/>
              <Option name="CompleterMatchFlags" type="int" value="2"/>
              <Option name="Description" type="QString" value=""/>
              <Option name="DisplayGroupName" type="bool" value="false"/>
              <Option name="FilterExpression" type="QString" value="{esc(filt)}"/>
              <Option name="Group" type="QString" value=""/>
              <Option name="Key" type="QString" value="value"/>
              <Option name="Layer" type="QString" value="{layer_id}"/>
              <Option name="LayerName" type="QString" value="{MULTISELECT_OPTS_TABLE}"/>
              <Option name="LayerSource" type="QString" value="attachment:data.gpkg|layername={MULTISELECT_OPTS_TABLE}"/>
              <Option name="LayerProviderName" type="QString" value="ogr"/>
              <Option name="NofColumns" type="int" value="1"/>
              <Option name="OrderByDescending" type="bool" value="false"/>
              <Option name="OrderByField" type="bool" value="false"/>
              <Option name="OrderByFieldName" type="QString" value=""/>
              <Option name="OrderByKey" type="bool" value="true"/>
              <Option name="OrderByValue" type="bool" value="false"/>
              <Option name="UseCompleter" type="bool" value="false"/>
              <Option name="Value" type="QString" value="label"/>
            </Option>
          </config>"""


def build_field_widget(field: dict[str, Any], fic_id: str, ms_id: str) -> str:
    ftype = field.get("type", "text")
    if ftype == "valuemap":
        widget, config = "ValueMap", build_value_map_config(field.get("options") or [])
    elif ftype == "multiselect":
        widget, config = "ValueRelation", build_multiselect_config(ms_id, field.get("name", ""))
    elif ftype == "valuerelation":
        filt = field.get("relationFilter") or "\"lateral\" = current_value('lateral')"
        widget, config = "ValueRelation", build_value_relation_config(fic_id, filt)
    elif ftype in ("date", "datetime"):
        widget, config = "DateTime", build_date_config()
    elif ftype == "boolean":
        widget, config = "CheckBox", build_boolean_config()
    elif ftype == "attachment":
        widget, config = "ExternalResource", build_attachment_config()
    elif ftype == "real":
        widget, config = "Range", build_range_config(True)
    elif ftype == "integer":
        widget, config = "Range", build_range_config(False)
    else:
        widget, config = "TextEdit", build_text_edit_config()

    name = esc(field.get("name", ""))
    return f"""        <field name="{name}" configurationFlags="None">
          <editWidget type="{widget}">
{config}
          </editWidget>
        </field>"""


def build_default_field_widget(name: str) -> str:
    return f"""        <field name="{esc(name)}" configurationFlags="None">
          <editWidget type="TextEdit">
{build_text_edit_config()}
          </editWidget>
        </field>"""


def build_layer_tree_entry(
    layer_id: str, name: str, source: str, provider_key: str, checked: bool
) -> str:
    chk = "Qt::Checked" if checked else "Qt::Unchecked"
    return f"""    <layer-tree-layer expanded="1" legendSplitBehavior="0" source="{esc(source)}" patch_size="-1,-1" name="{esc(name)}" providerKey="{provider_key}" id="{layer_id}" checked="{chk}">
      <customproperties>
        <Option/>
      </customproperties>
    </layer-tree-layer>"""


def build_plots_maplayer(config: dict[str, Any], layer_ids: dict[str, Any]) -> str:
    kept = [c for c in (config.get("keptColumns") or []) if c.get("keep")]
    fields = config.get("fields") or []
    table = config.get("tableName") or "farm_plots"
    plots_id = layer_ids["plotsLayerId"]
    fic_id = layer_ids["ficLookupLayerId"]
    ms_id = layer_ids["multiselectOptsLayerId"]

    widgets = "\n".join(
        [build_default_field_widget(c["name"]) for c in kept]
        + [build_field_widget(f, fic_id, ms_id) for f in fields]
    )
    all_names = [c["name"] for c in kept] + [f["name"] for f in fields]
    aliases = "\n".join(
        f'        <alias index="{i}" field="{esc(n)}" name=""/>' for i, n in enumerate(all_names)
    )
    defaults = "\n".join(
        f'        <default field="{esc(n)}" expression="" applyOnUpdate="0"/>' for n in all_names
    )
    constraints = "\n".join(
        f'        <constraint field="{esc(n)}" constraints="0" notnull_strength="0" unique_strength="0" exp_strength="0"/>'
        for n in all_names
    )
    constraint_exprs = "\n".join(
        f'        <constraintExpression field="{esc(n)}" exp="" desc=""/>' for n in all_names
    )
    editor_fields = "\n".join(
        f'          <attributeEditorField name="{esc(f["name"])}" horizontalStretch="0" verticalStretch="0" showLabel="1"/>'
        for f in fields
    )
    preview = esc((fields[0]["name"] if fields else (kept[0]["name"] if kept else "fid")))

    return f"""    <maplayer type="vector" autoRefreshEnabled="0" autoRefreshTime="0" hasScaleBasedVisibilityFlag="0" maxScale="0" minScale="1e+08" readOnly="0" refreshOnNotifyEnabled="0" refreshOnNotifyMessage="" styleCategories="AllStyleCategories">
      <id>{plots_id}</id>
      <datasource>{esc(gpkg_datasource(table))}</datasource>
      <keywordList><value/></keywordList>
      <layername>{esc(table)}</layername>
      <srs>
        {SRS_4326}
      </srs>
      <provider encoding="UTF-8">ogr</provider>
      <vectorjoins/>
      <layerDependencies/>
      <dataDependencies/>
      <expressionfields/>
      <map-layer-style-manager current="default">
        <map-layer-style name="default"/>
      </map-layer-style-manager>
      <customproperties>
        <Option/>
      </customproperties>
      <auxiliaryLayer/>
      <flags>
        <Identifiable>1</Identifiable>
        <Removable>1</Removable>
        <Searchable>1</Searchable>
        <Private>0</Private>
      </flags>
      <geometryOptions removeDuplicateNodes="0" geometryPrecision="0">
        <activeChecks/>
        <checkConfiguration/>
      </geometryOptions>
      <referencedLayers/>
      <fieldConfiguration>
{widgets}
      </fieldConfiguration>
      <aliases>
{aliases}
      </aliases>
      <defaults>
{defaults}
      </defaults>
      <constraints>
{constraints}
      </constraints>
      <constraintExpressions>
{constraint_exprs}
      </constraintExpressions>
      <attributeactions/>
      <attributeEditorForm>
        <attributeEditorContainer name="root" type="Tab" collapsed="0" columnCount="1" groupBox="0" horizontalStretch="0" verticalStretch="0" showLabel="1" visibilityExpressionEnabled="0" visibilityExpression="">
          <attributeEditorContainer name="Plot details" type="Group" collapsed="0" columnCount="1" groupBox="1" horizontalStretch="0" verticalStretch="0" showLabel="1" visibilityExpressionEnabled="0" visibilityExpression="">
{editor_fields}
          </attributeEditorContainer>
        </attributeEditorContainer>
      </attributeEditorForm>
      <editorlayout>tablayout</editorlayout>
      <featformsuppress>0</featformsuppress>
      <legend type="default-vector"/>
      <mapTip enabled="1"></mapTip>
      <previewExpression>"{preview}"</previewExpression>
      <renderer-v2 type="singleSymbol" forceraster="0" enableorderby="0" referencescale="-1" symbollevels="0">
        <symbols>
          <symbol type="fill" alpha="0.6" clip_to_extent="1" frame_rate="10" is_animated="0" name="0" force_rhr="0">
            <data_defined_properties>
              <Option type="Map">
                <Option name="name" type="QString" value=""/>
                <Option name="properties"/>
                <Option name="type" type="QString" value="collection"/>
              </Option>
            </data_defined_properties>
            <layer class="SimpleFill" locked="0" pass="0" enabled="1">
              <Option type="Map">
                <Option name="border_width_map_unit_scale" type="QString" value="3x:0,0,0,0,0,0"/>
                <Option name="color" type="QString" value="96,165,250,153"/>
                <Option name="joinstyle" type="QString" value="bevel"/>
                <Option name="offset" type="QString" value="0,0"/>
                <Option name="offset_map_unit_scale" type="QString" value="3x:0,0,0,0,0,0"/>
                <Option name="offset_unit" type="QString" value="MM"/>
                <Option name="outline_color" type="QString" value="37,99,235,255"/>
                <Option name="outline_style" type="QString" value="solid"/>
                <Option name="outline_width" type="QString" value="0.5"/>
                <Option name="outline_width_unit" type="QString" value="MM"/>
                <Option name="style" type="QString" value="solid"/>
              </Option>
            </layer>
          </symbol>
        </symbols>
      </renderer-v2>
      <blendMode>0</blendMode>
      <featureBlendMode>0</featureBlendMode>
      <layerGeometryType>2</layerGeometryType>
    </maplayer>"""


def build_point_lookup_maplayer(
    layer_id: str, datasource: str, layer_name: str, preview_field: str
) -> str:
    return f"""    <maplayer type="vector" autoRefreshEnabled="0" autoRefreshTime="0" hasScaleBasedVisibilityFlag="0" maxScale="0" minScale="1e+08" readOnly="1" refreshOnNotifyEnabled="0" refreshOnNotifyMessage="" styleCategories="AllStyleCategories">
      <id>{layer_id}</id>
      <datasource>{esc(datasource)}</datasource>
      <keywordList><value/></keywordList>
      <layername>{esc(layer_name)}</layername>
      <srs>
        {SRS_4326}
      </srs>
      <provider encoding="UTF-8">ogr</provider>
      <vectorjoins/>
      <layerDependencies/>
      <dataDependencies/>
      <expressionfields/>
      <map-layer-style-manager current="default">
        <map-layer-style name="default"/>
      </map-layer-style-manager>
      <customproperties>
        <Option/>
      </customproperties>
      <auxiliaryLayer/>
      <flags>
        <Identifiable>0</Identifiable>
        <Removable>1</Removable>
        <Searchable>0</Searchable>
        <Private>1</Private>
      </flags>
      <geometryOptions removeDuplicateNodes="0" geometryPrecision="0">
        <activeChecks/>
        <checkConfiguration/>
      </geometryOptions>
      <referencedLayers/>
      <fieldConfiguration/>
      <aliases/>
      <defaults/>
      <constraints/>
      <constraintExpressions/>
      <attributeactions/>
      <editorlayout>generatedlayout</editorlayout>
      <featformsuppress>1</featformsuppress>
      <legend type="default-vector"/>
      <mapTip enabled="0"></mapTip>
      <previewExpression>"{esc(preview_field)}"</previewExpression>
      <renderer-v2 type="singleSymbol" forceraster="0" enableorderby="0" referencescale="-1" symbollevels="0">
        <symbols>
          <symbol type="marker" alpha="0" clip_to_extent="1" frame_rate="10" is_animated="0" name="0" force_rhr="0">
            <data_defined_properties>
              <Option type="Map">
                <Option name="name" type="QString" value=""/>
                <Option name="properties"/>
                <Option name="type" type="QString" value="collection"/>
              </Option>
            </data_defined_properties>
            <layer class="SimpleMarker" locked="0" pass="0" enabled="1">
              <Option type="Map">
                <Option name="angle" type="QString" value="0"/>
                <Option name="color" type="QString" value="0,0,0,0"/>
                <Option name="name" type="QString" value="circle"/>
                <Option name="offset" type="QString" value="0,0"/>
                <Option name="outline_color" type="QString" value="0,0,0,0"/>
                <Option name="outline_style" type="QString" value="no"/>
                <Option name="size" type="QString" value="2"/>
                <Option name="size_unit" type="QString" value="MM"/>
              </Option>
            </layer>
          </symbol>
        </symbols>
      </renderer-v2>
      <blendMode>0</blendMode>
      <featureBlendMode>0</featureBlendMode>
      <layerGeometryType>0</layerGeometryType>
    </maplayer>"""


def build_basemap_raster_layer(bm: dict[str, Any], layer_id: str) -> str:
    datasource, provider, name = basemap_qgs_info(bm)
    return f"""    <maplayer type="raster" autoRefreshEnabled="0" autoRefreshTime="0" hasScaleBasedVisibilityFlag="0" maxScale="0" minScale="1e+08" refreshOnNotifyEnabled="0" refreshOnNotifyMessage="" styleCategories="AllStyleCategories">
      <id>{layer_id}</id>
      <datasource>{esc(datasource)}</datasource>
      <keywordList><value/></keywordList>
      <layername>{esc(name)}</layername>
      <srs>
        {SRS_4326}
      </srs>
      <provider>{provider}</provider>
      <map-layer-style-manager current="default">
        <map-layer-style name="default"/>
      </map-layer-style-manager>
      <customproperties>
        <Option/>
      </customproperties>
      <flags>
        <Identifiable>1</Identifiable>
        <Removable>1</Removable>
        <Searchable>1</Searchable>
        <Private>0</Private>
      </flags>
      <pipe>
        <provider>
          <resampling enabled="false" maxOversampling="2" zoomedInResamplingMethod="nearestNeighbour" zoomedOutResamplingMethod="nearestNeighbour"/>
        </provider>
        <rasterrenderer type="multibandcolor" opacity="1" alphaBand="-1" greenBand="2" redBand="1" blueBand="3">
          <rasterTransparency/>
          <minMaxOrigin>
            <limits>None</limits>
            <extent>WholeRaster</extent>
            <statAccuracy>Estimated</statAccuracy>
            <cumulativeCutLower>0.02</cumulativeCutLower>
            <cumulativeCutUpper>0.98</cumulativeCutUpper>
            <stdDevFactor>2</stdDevFactor>
          </minMaxOrigin>
        </rasterrenderer>
        <brightnesscontrast gamma="1" brightness="0" contrast="0"/>
        <huesaturation colorizeGreen="128" colorizeRed="255" grayscaleMode="0" colorizeStrength="100" colorizeBlue="128" invertColors="0" colorizeOn="0" saturation="0"/>
        <rasterresampler maxOversampling="2"/>
        <resamplingStage>resamplingFilter</resamplingStage>
      </pipe>
      <blendMode>0</blendMode>
    </maplayer>"""


def build_qgs_project(config: dict[str, Any], layer_ids: dict[str, Any]) -> str:
    project_name = config.get("projectName") or "Farm Survey"
    table = config.get("tableName") or "farm_plots"
    # Offline basemaps (MBTiles) above online (OSM) in the layer tree
    raw_basemaps = list(config.get("basemaps") or [])
    indexed = list(enumerate(raw_basemaps))
    indexed.sort(key=lambda t: 0 if not t[1].get("requiresInternet", True) else 1)
    basemaps = [bm for _, bm in indexed]
    sorted_basemap_ids = [layer_ids["basemapLayerIds"][i] for i, _ in indexed]
    min_x, min_y, max_x, max_y = compute_extent(config.get("boundaries") or {})

    plots_tree = build_layer_tree_entry(
        layer_ids["plotsLayerId"], table, gpkg_datasource(table), "ogr", True
    )
    fic_tree = build_layer_tree_entry(
        layer_ids["ficLookupLayerId"],
        FIC_LOOKUP_TABLE,
        gpkg_datasource(FIC_LOOKUP_TABLE),
        "ogr",
        False,
    )
    ms_tree = build_layer_tree_entry(
        layer_ids["multiselectOptsLayerId"],
        MULTISELECT_OPTS_TABLE,
        gpkg_datasource(MULTISELECT_OPTS_TABLE),
        "ogr",
        False,
    )
    bm_trees = []
    for i, bm in enumerate(basemaps):
        ds, prov, name = basemap_qgs_info(bm)
        bm_trees.append(
            build_layer_tree_entry(sorted_basemap_ids[i], name, ds, prov, True)
        )

    plots_ml = build_plots_maplayer(config, layer_ids)
    fic_ml = build_point_lookup_maplayer(
        layer_ids["ficLookupLayerId"],
        gpkg_datasource(FIC_LOOKUP_TABLE),
        FIC_LOOKUP_TABLE,
        "fic",
    )
    ms_ml = build_point_lookup_maplayer(
        layer_ids["multiselectOptsLayerId"],
        gpkg_datasource(MULTISELECT_OPTS_TABLE),
        MULTISELECT_OPTS_TABLE,
        "label",
    )
    bm_mls = "\n".join(
        build_basemap_raster_layer(bm, sorted_basemap_ids[i])
        for i, bm in enumerate(basemaps)
    )

    # layerorder: first = bottom. Online basemaps under offline, vectors on top.
    online_ids = [
        sorted_basemap_ids[i]
        for i, bm in enumerate(basemaps)
        if bm.get("requiresInternet", True)
    ]
    offline_ids = [
        sorted_basemap_ids[i]
        for i, bm in enumerate(basemaps)
        if not bm.get("requiresInternet", True)
    ]
    all_ids = [
        *online_ids,
        *offline_ids,
        layer_ids["ficLookupLayerId"],
        layer_ids["multiselectOptsLayerId"],
        layer_ids["plotsLayerId"],
    ]
    layerorder = "\n    ".join(f'<layer id="{lid}"/>' for lid in all_ids)

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<qgis saveUserFull="" saveUser="" projectname="{esc(project_name)}" version="3.34.0">
  <homePath path=""/>
  <title>{esc(project_name)}</title>
  <autotransaction active="0"/>
  <evaluateDefaultValues active="0"/>
  <trust active="0"/>
  <projectCrs>
    {SRS_4326}
  </projectCrs>
  <layer-tree-group name="" checked="Qt::Checked" expanded="1">
    <customproperties>
      <Option/>
    </customproperties>
{plots_tree}
{fic_tree}
{ms_tree}
{chr(10).join(bm_trees)}
    <custom-order enabled="1"/>
  </layer-tree-group>
  <snapping-settings enabled="0" type="1" tolerance="12" unit="1" intersection-snapping="0" mode="2" scaleDependencyMode="0" minScale="0" maxScale="0">
    <individual-layer-settings/>
  </snapping-settings>
  <relations/>
  <polymorphicRelations/>
  <mapcanvas name="theMapCanvas" annotationsVisible="1">
    <units>meters</units>
    <extent>
      <xmin>{min_x}</xmin>
      <ymin>{min_y}</ymin>
      <xmax>{max_x}</xmax>
      <ymax>{max_y}</ymax>
    </extent>
    <rotation>0</rotation>
    <destinationsrs>
      {SRS_4326}
    </destinationsrs>
    <rendermaptile>0</rendermaptile>
  </mapcanvas>
  <projectlayers>
{plots_ml}
{fic_ml}
{ms_ml}
{bm_mls}
  </projectlayers>
  <layerorder>
    {layerorder}
  </layerorder>
  <properties>
    <Option type="Map">
      <Option name="Paths" type="Map">
        <Option name="Absolute" type="bool" value="false"/>
      </Option>
      <Option name="MeasureAreaUnits" type="QString" value="m2"/>
      <Option name="MeasureDistanceUnits" type="QString" value="m"/>
    </Option>
  </properties>
  <dataDefinedServerProperties/>
  <visibility-presets/>
  <transformContext/>
  <projectMetadata>
    <identifier></identifier>
    <parentidentifier></parentidentifier>
    <language></language>
    <type></type>
    <title>{esc(project_name)}</title>
    <abstract></abstract>
    <links/>
    <history/>
    <dates/>
    <contacts/>
    <encoding>UTF-8</encoding>
  </projectMetadata>
  <metadataUrls/>
</qgis>"""
