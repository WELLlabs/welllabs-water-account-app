import type { ColumnConfig, FicMapping, FormField, FormProjectConfig } from './types';
import { basemapQgsInfo, type AnyBasemap } from './basemaps';

const FIC_LOOKUP_TABLE = 'fic_lookup';
const FIC_LOOKUP_LAYER_ID = 'fic_lookup_layer';
export const MULTISELECT_OPTS_TABLE = 'multiselect_opts';

export interface LayerIds {
	plotsLayerId: string;
	ficLookupLayerId: string;
	multiselectOptsLayerId: string;
	/** One ID per basemap, in the same order as config.basemaps */
	basemapLayerIds: string[];
}

// ─── XML helpers ─────────────────────────────────────────────────────────────

function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/** Standard EPSG:4326 SRS block used everywhere. */
const SRS_4326 = `<spatialrefsys nativeFormat="Wkt">
          <wkt>GEOGCRS["WGS 84",DATUM["World Geodetic System 1984",ELLIPSOID["WGS 84",6378137,298.257223563,LENGTHUNIT["metre",1]]],PRIMEM["Greenwich",0,ANGLEUNIT["degree",0.0174532925199433]],CS[ellipsoidal,2],AXIS["geodetic latitude (Lat)",north,ORDER[1],ANGLEUNIT["degree",0.0174532925199433]],AXIS["geodetic longitude (Lon)",east,ORDER[2],ANGLEUNIT["degree",0.0174532925199433]],USAGE[SCOPE["Horizontal component of 3D system."],AREA["World."],BBOX[-90,-180,90,180]],ID["EPSG",4326]]</wkt>
          <proj4>+proj=longlat +datum=WGS84 +no_defs</proj4>
          <srsid>3452</srsid>
          <srid>4326</srid>
          <authid>EPSG:4326</authid>
          <description>WGS 84</description>
          <projectionacronym>longlat</projectionacronym>
          <ellipsoidacronym>WGS84</ellipsoidacronym>
          <geographicflag>true</geographicflag>
        </spatialrefsys>`;

// ─── Widget config builders ───────────────────────────────────────────────────

function buildValueMapConfig(options: { value: string; label: string }[]): string {
	const entries = options
		.map(
			(opt) =>
				`              <Option name="${escapeXml(opt.label)}" type="QString" value="${escapeXml(opt.value)}"/>`
		)
		.join('\n');
	return `<config>
            <Option type="Map">
              <Option name="map" type="Map">
${entries}
              </Option>
            </Option>
          </config>`;
}

function buildTextEditConfig(multiline = false): string {
	return `<config>
            <Option type="Map">
              <Option name="IsMultiline" type="bool" value="${multiline ? 'true' : 'false'}"/>
              <Option name="UseHtml" type="bool" value="false"/>
            </Option>
          </config>`;
}

function buildDateConfig(): string {
	return `<config>
            <Option type="Map">
              <Option name="allow_null" type="bool" value="true"/>
              <Option name="calendar_popup" type="bool" value="true"/>
              <Option name="display_format" type="QString" value="yyyy-MM-dd"/>
              <Option name="field_format" type="QString" value="yyyy-MM-dd"/>
              <Option name="field_iso_format" type="bool" value="false"/>
            </Option>
          </config>`;
}

function buildBooleanConfig(): string {
	return `<config>
            <Option type="Map">
              <Option name="CheckedState" type="int" value="2"/>
              <Option name="TextDisplayMethod" type="int" value="0"/>
              <Option name="UncheckedState" type="int" value="0"/>
            </Option>
          </config>`;
}

function buildAttachmentConfig(): string {
	return `<config>
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
          </config>`;
}

function buildRangeConfig(isReal: boolean): string {
	return `<config>
            <Option type="Map">
              <Option name="AllowNull" type="bool" value="true"/>
              <Option name="Max" type="${isReal ? 'double' : 'int'}" value="${isReal ? '1e+12' : '2147483647'}"/>
              <Option name="Min" type="${isReal ? 'double' : 'int'}" value="${isReal ? '-1e+12' : '-2147483648'}"/>
              <Option name="Precision" type="int" value="${isReal ? '6' : '0'}"/>
              <Option name="Step" type="${isReal ? 'double' : 'int'}" value="1"/>
              <Option name="Style" type="QString" value="SpinBox"/>
            </Option>
          </config>`;
}

function buildValueRelationConfig(
	ficLookupLayerId: string,
	filterExpression: string
): string {
	return `<config>
            <Option type="Map">
              <Option name="AllowMulti" type="bool" value="false"/>
              <Option name="AllowNull" type="bool" value="true"/>
              <Option name="CompleterMatchFlags" type="int" value="2"/>
              <Option name="Description" type="QString" value=""/>
              <Option name="DisplayGroupName" type="bool" value="false"/>
              <Option name="FilterExpression" type="QString" value="${escapeXml(filterExpression)}"/>
              <Option name="Group" type="QString" value=""/>
              <Option name="Key" type="QString" value="fic"/>
              <Option name="Layer" type="QString" value="${ficLookupLayerId}"/>
              <Option name="LayerName" type="QString" value="${FIC_LOOKUP_TABLE}"/>
              <Option name="LayerSource" type="QString" value="attachment:data.gpkg|layername=${FIC_LOOKUP_TABLE}"/>
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
          </config>`;
}

function buildMultiselectConfig(multiselectOptsLayerId: string, fieldName: string): string {
	const filter = `"field_name" = '${fieldName}'`;
	return `<config>
            <Option type="Map">
              <Option name="AllowMulti" type="bool" value="true"/>
              <Option name="AllowNull" type="bool" value="true"/>
              <Option name="CompleterMatchFlags" type="int" value="2"/>
              <Option name="Description" type="QString" value=""/>
              <Option name="DisplayGroupName" type="bool" value="false"/>
              <Option name="FilterExpression" type="QString" value="${escapeXml(filter)}"/>
              <Option name="Group" type="QString" value=""/>
              <Option name="Key" type="QString" value="value"/>
              <Option name="Layer" type="QString" value="${multiselectOptsLayerId}"/>
              <Option name="LayerName" type="QString" value="${MULTISELECT_OPTS_TABLE}"/>
              <Option name="LayerSource" type="QString" value="attachment:data.gpkg|layername=${MULTISELECT_OPTS_TABLE}"/>
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
          </config>`;
}

function buildFieldWidget(
	field: FormField,
	ficLookupLayerId: string,
	multiselectOptsLayerId: string
): string {
	let widgetType: string;
	let config: string;

	switch (field.type) {
		case 'valuemap':
			widgetType = 'ValueMap';
			config = buildValueMapConfig(field.options ?? []);
			break;
		case 'multiselect':
			widgetType = 'ValueRelation';
			config = buildMultiselectConfig(multiselectOptsLayerId, field.name);
			break;
		case 'valuerelation':
			widgetType = 'ValueRelation';
			config = buildValueRelationConfig(
				ficLookupLayerId,
				field.relationFilter ?? `"lateral" = current_value('lateral')`
			);
			break;
		case 'date':
		case 'datetime':
			widgetType = 'DateTime';
			config = buildDateConfig();
			break;
		case 'boolean':
			widgetType = 'CheckBox';
			config = buildBooleanConfig();
			break;
		case 'attachment':
			widgetType = 'ExternalResource';
			config = buildAttachmentConfig();
			break;
		case 'real':
			widgetType = 'Range';
			config = buildRangeConfig(true);
			break;
		case 'integer':
			widgetType = 'Range';
			config = buildRangeConfig(false);
			break;
		default:
			widgetType = 'TextEdit';
			config = buildTextEditConfig();
	}

	return `        <field name="${escapeXml(field.name)}" configurationFlags="None">
          <editWidget type="${widgetType}">
${config}
          </editWidget>
        </field>`;
}

/** Default TextEdit widget entry for columns not in the form (kept columns). */
function buildDefaultFieldWidget(name: string): string {
	return `        <field name="${escapeXml(name)}" configurationFlags="None">
          <editWidget type="TextEdit">
${buildTextEditConfig()}
          </editWidget>
        </field>`;
}

// ─── Layer-tree and maplayer builders ────────────────────────────────────────

function buildPlotsLayerMaplayer(
	config: FormProjectConfig,
	layerIds: LayerIds
): string {
	const keptCols = (config.keptColumns ?? []).filter((c) => c.keep);
	const keptWidgets = keptCols.map((c) => buildDefaultFieldWidget(c.name)).join('\n');
	const formWidgets = config.fields
		.map((f) => buildFieldWidget(f, layerIds.ficLookupLayerId, layerIds.multiselectOptsLayerId))
		.join('\n');
	const fieldConfigBody = [keptWidgets, formWidgets].filter(Boolean).join('\n');

	const allFieldNames = [
		...keptCols.map((c) => c.name),
		...config.fields.map((f) => f.name)
	];

	const aliases = allFieldNames
		.map((n, i) => `        <alias index="${i}" field="${escapeXml(n)}" name=""/>`)
		.join('\n');
	const defaults = allFieldNames
		.map((n) => `        <default field="${escapeXml(n)}" expression="" applyOnUpdate="0"/>`)
		.join('\n');
	const constraints = allFieldNames
		.map(
			(n) =>
				`        <constraint field="${escapeXml(n)}" constraints="0" notnull_strength="0" unique_strength="0" exp_strength="0"/>`
		)
		.join('\n');
	const constraintExprs = allFieldNames
		.map((n) => `        <constraintExpression field="${escapeXml(n)}" exp="" desc=""/>`)
		.join('\n');

	const editorFields = config.fields
		.map(
			(f) =>
				`          <attributeEditorField name="${escapeXml(f.name)}" horizontalStretch="0" verticalStretch="0" showLabel="1"/>`
		)
		.join('\n');

	const previewField = config.fields[0]?.name ?? keptCols[0]?.name ?? 'fid';

	return `    <maplayer type="vector" autoRefreshEnabled="0" autoRefreshTime="0" hasScaleBasedVisibilityFlag="0" maxScale="0" minScale="1e+08" readOnly="0" refreshOnNotifyEnabled="0" refreshOnNotifyMessage="" styleCategories="AllStyleCategories">
      <id>${layerIds.plotsLayerId}</id>
      <datasource>attachment:data.gpkg|layername=${escapeXml(config.tableName)}</datasource>
      <keywordList><value/></keywordList>
      <layername>${escapeXml(config.tableName)}</layername>
      <srs>
        ${SRS_4326}
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
${fieldConfigBody}
      </fieldConfiguration>
      <aliases>
${aliases}
      </aliases>
      <defaults>
${defaults}
      </defaults>
      <constraints>
${constraints}
      </constraints>
      <constraintExpressions>
${constraintExprs}
      </constraintExpressions>
      <attributeactions/>
      <attributeEditorForm>
        <attributeEditorContainer name="root" type="Tab" collapsed="0" columnCount="1" groupBox="0" horizontalStretch="0" verticalStretch="0" showLabel="1" visibilityExpressionEnabled="0" visibilityExpression="">
          <attributeEditorContainer name="Plot details" type="Group" collapsed="0" columnCount="1" groupBox="1" horizontalStretch="0" verticalStretch="0" showLabel="1" visibilityExpressionEnabled="0" visibilityExpression="">
${editorFields}
          </attributeEditorContainer>
        </attributeEditorContainer>
      </attributeEditorForm>
      <editorlayout>tablayout</editorlayout>
      <featformsuppress>0</featformsuppress>
      <legend type="default-vector"/>
      <mapTip enabled="1"></mapTip>
      <previewExpression>"${escapeXml(previewField)}"</previewExpression>
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
    </maplayer>`;
}

function buildPointLookupMaplayer(
	id: string,
	datasource: string,
	layerName: string,
	previewField: string,
	isPrivate = true
): string {
	return `    <maplayer type="vector" autoRefreshEnabled="0" autoRefreshTime="0" hasScaleBasedVisibilityFlag="0" maxScale="0" minScale="1e+08" readOnly="1" refreshOnNotifyEnabled="0" refreshOnNotifyMessage="" styleCategories="AllStyleCategories">
      <id>${id}</id>
      <datasource>${escapeXml(datasource)}</datasource>
      <keywordList><value/></keywordList>
      <layername>${escapeXml(layerName)}</layername>
      <srs>
        ${SRS_4326}
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
        <Identifiable>${isPrivate ? '0' : '1'}</Identifiable>
        <Removable>1</Removable>
        <Searchable>0</Searchable>
        <Private>${isPrivate ? '1' : '0'}</Private>
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
      <previewExpression>"${escapeXml(previewField)}"</previewExpression>
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
    </maplayer>`;
}

function buildBasemapRasterLayer(bm: AnyBasemap, layerId: string): string {
	const { datasource, provider } = basemapQgsInfo(bm);
	const name = bm.requiresInternet
		? bm.label
		: (bm as import('./basemaps').OfflineBasemap).file.name;

	return `    <maplayer type="raster" autoRefreshEnabled="0" autoRefreshTime="0" hasScaleBasedVisibilityFlag="0" maxScale="0" minScale="1e+08" refreshOnNotifyEnabled="0" refreshOnNotifyMessage="" styleCategories="AllStyleCategories">
      <id>${layerId}</id>
      <datasource>${escapeXml(datasource)}</datasource>
      <keywordList><value/></keywordList>
      <layername>${escapeXml(name)}</layername>
      <srs>
        ${SRS_4326}
      </srs>
      <provider>${provider}</provider>
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
    </maplayer>`;
}

function buildLayerTreeEntry(
	id: string,
	name: string,
	source: string,
	providerKey: string,
	checked: boolean
): string {
	return `    <layer-tree-layer expanded="1" legendSplitBehavior="0" source="${escapeXml(source)}" patch_size="-1,-1" name="${escapeXml(name)}" providerKey="${providerKey}" id="${id}" checked="${checked ? 'Qt::Checked' : 'Qt::Unchecked'}">
      <customproperties>
        <Option/>
      </customproperties>
    </layer-tree-layer>`;
}

// ─── Extent ──────────────────────────────────────────────────────────────────

function computeExtent(boundaries: GeoJSON.FeatureCollection): {
	minX: number; minY: number; maxX: number; maxY: number;
} {
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const feature of boundaries.features) {
		for (const [x, y] of extractCoords(feature.geometry)) {
			minX = Math.min(minX, x); minY = Math.min(minY, y);
			maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
		}
	}
	if (!Number.isFinite(minX)) return { minX: 76.5, minY: 16.0, maxX: 77.0, maxY: 16.5 };
	const padX = (maxX - minX) * 0.1 || 0.01;
	const padY = (maxY - minY) * 0.1 || 0.01;
	return { minX: minX - padX, minY: minY - padY, maxX: maxX + padX, maxY: maxY + padY };
}

function extractCoords(geometry: GeoJSON.Geometry): number[][] {
	if (geometry.type === 'Point') return [geometry.coordinates as number[]];
	if (geometry.type === 'MultiPoint' || geometry.type === 'LineString')
		return geometry.coordinates as number[][];
	if (geometry.type === 'MultiLineString' || geometry.type === 'Polygon')
		return (geometry.coordinates as number[][][]).flat();
	if (geometry.type === 'MultiPolygon')
		return (geometry.coordinates as number[][][][]).flat(2);
	return [];
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function buildQgsProject(config: FormProjectConfig, layerIds: LayerIds): string {
	const { minX, minY, maxX, maxY } = computeExtent(config.boundaries);

	// Layer tree entries (top = data layers, bottom = basemaps)
	const plotsTreeEntry = buildLayerTreeEntry(
		layerIds.plotsLayerId,
		config.tableName,
		`attachment:data.gpkg|layername=${config.tableName}`,
		'ogr',
		true
	);
	const ficTreeEntry = buildLayerTreeEntry(
		layerIds.ficLookupLayerId,
		FIC_LOOKUP_TABLE,
		`attachment:data.gpkg|layername=${FIC_LOOKUP_TABLE}`,
		'ogr',
		false
	);
	const msTreeEntry = buildLayerTreeEntry(
		layerIds.multiselectOptsLayerId,
		MULTISELECT_OPTS_TABLE,
		`attachment:data.gpkg|layername=${MULTISELECT_OPTS_TABLE}`,
		'ogr',
		false
	);
	const basemapTreeEntries = config.basemaps
		.map((bm, i) => {
			const { datasource, provider } = basemapQgsInfo(bm);
			const name = bm.requiresInternet
				? bm.label
				: (bm as import('./basemaps').OfflineBasemap).file.name;
			return buildLayerTreeEntry(layerIds.basemapLayerIds[i], name, datasource, provider, true);
		})
		.join('\n');

	// Maplayer entries
	const plotsMaplayer = buildPlotsLayerMaplayer(config, layerIds);
	const ficMaplayer = buildPointLookupMaplayer(
		layerIds.ficLookupLayerId,
		`attachment:data.gpkg|layername=${FIC_LOOKUP_TABLE}`,
		FIC_LOOKUP_TABLE,
		'fic'
	);
	const msMaplayer = buildPointLookupMaplayer(
		layerIds.multiselectOptsLayerId,
		`attachment:data.gpkg|layername=${MULTISELECT_OPTS_TABLE}`,
		MULTISELECT_OPTS_TABLE,
		'label'
	);
	const basemapRasterLayers = config.basemaps
		.map((bm, i) => buildBasemapRasterLayer(bm, layerIds.basemapLayerIds[i]))
		.join('\n');

	const allLayerIds = [
		layerIds.plotsLayerId,
		layerIds.ficLookupLayerId,
		layerIds.multiselectOptsLayerId,
		...layerIds.basemapLayerIds
	];

	return `<?xml version="1.0" encoding="UTF-8"?>
<qgis saveUserFull="" saveUser="" projectname="${escapeXml(config.projectName)}" version="3.34.0">
  <homePath path=""/>
  <title>${escapeXml(config.projectName)}</title>
  <autotransaction active="0"/>
  <evaluateDefaultValues active="0"/>
  <trust active="0"/>
  <projectCrs>
    ${SRS_4326}
  </projectCrs>
  <layer-tree-group name="" checked="Qt::Checked" expanded="1">
    <customproperties>
      <Option/>
    </customproperties>
${plotsTreeEntry}
${ficTreeEntry}
${msTreeEntry}
${basemapTreeEntries}
    <custom-order enabled="0"/>
  </layer-tree-group>
  <snapping-settings enabled="0" type="1" tolerance="12" unit="1" intersection-snapping="0" mode="2" scaleDependencyMode="0" minScale="0" maxScale="0">
    <individual-layer-settings/>
  </snapping-settings>
  <relations/>
  <polymorphicRelations/>
  <mapcanvas name="theMapCanvas" annotationsVisible="1">
    <units>degrees</units>
    <extent>
      <xmin>${minX}</xmin>
      <ymin>${minY}</ymin>
      <xmax>${maxX}</xmax>
      <ymax>${maxY}</ymax>
    </extent>
    <rotation>0</rotation>
    <destinationsrs>
      ${SRS_4326}
    </destinationsrs>
    <rendermaptile>0</rendermaptile>
  </mapcanvas>
  <projectlayers>
${plotsMaplayer}
${ficMaplayer}
${msMaplayer}
${basemapRasterLayers}
  </projectlayers>
  <layerorder>
    ${allLayerIds.map((id) => `<layer id="${id}"/>`).join('\n    ')}
  </layerorder>
  <properties>
    <Option type="Map">
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
    <title>${escapeXml(config.projectName)}</title>
    <abstract></abstract>
    <links/>
    <history/>
    <dates/>
    <contacts/>
    <encoding>UTF-8</encoding>
  </projectMetadata>
  <metadataUrls/>
</qgis>`;
}

export function createLayerIds(basemapCount: number): LayerIds {
	return {
		plotsLayerId: crypto.randomUUID(),
		ficLookupLayerId: FIC_LOOKUP_LAYER_ID + '_' + crypto.randomUUID().slice(0, 8),
		multiselectOptsLayerId: 'multiselect_opts_layer_' + crypto.randomUUID().slice(0, 8),
		basemapLayerIds: Array.from({ length: basemapCount }, () => crypto.randomUUID())
	};
}

/** Build GeoJSON point features for the fic_lookup table. */
export function buildFicLookupFeatures(mappings: FicMapping[]): GeoJSON.Feature[] {
	const features: GeoJSON.Feature[] = [];
	for (const mapping of mappings) {
		for (const fic of mapping.fics) {
			features.push({
				type: 'Feature',
				geometry: { type: 'Point', coordinates: [0, 0] },
				properties: { lateral: mapping.lateral, fic }
			});
		}
	}
	return features;
}

/** Build GeoJSON point features for the multiselect_opts lookup table. */
export function buildMultiselectOptFeatures(fields: FormField[]): GeoJSON.Feature[] {
	const features: GeoJSON.Feature[] = [];
	for (const field of fields) {
		if (field.type !== 'multiselect' || !field.options?.length) continue;
		for (const opt of field.options) {
			features.push({
				type: 'Feature',
				geometry: { type: 'Point', coordinates: [0, 0] },
				properties: { field_name: field.name, value: opt.value, label: opt.label }
			});
		}
	}
	return features;
}
