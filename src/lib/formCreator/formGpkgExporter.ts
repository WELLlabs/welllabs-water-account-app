import { GeoPackageAPI } from '@ngageoint/geopackage';
import type { ColumnConfig, FicMapping, FormField, FormProjectConfig } from './types';
import { QGIS_FIELD_TYPES } from './types';
import { buildFicLookupFeatures, buildMultiselectOptFeatures, MULTISELECT_OPTS_TABLE } from './qgsProjectBuilder';

const FIC_LOOKUP_TABLE = 'fic_lookup';

function computeBoundingBox(features: GeoJSON.Feature[]) {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;

	for (const feature of features) {
		const coords = extractCoordinates(feature.geometry);
		for (const [x, y] of coords) {
			minX = Math.min(minX, x);
			minY = Math.min(minY, y);
			maxX = Math.max(maxX, x);
			maxY = Math.max(maxY, y);
		}
	}

	if (!Number.isFinite(minX)) {
		return { minX: 76.5, minY: 16.0, maxX: 77.0, maxY: 16.5 };
	}
	return { minX, minY, maxX, maxY };
}

function extractCoordinates(geometry: GeoJSON.Geometry): number[][] {
	if (geometry.type === 'Point') return [geometry.coordinates as number[]];
	if (geometry.type === 'MultiPoint' || geometry.type === 'LineString') {
		return geometry.coordinates as number[][];
	}
	if (geometry.type === 'MultiLineString' || geometry.type === 'Polygon') {
		return (geometry.coordinates as number[][][]).flat();
	}
	if (geometry.type === 'MultiPolygon') {
		return (geometry.coordinates as number[][][][]).flat(2);
	}
	return [];
}

function fieldToColumnDef(field: FormField): { name: string; dataType: string } {
	return {
		name: field.name,
		dataType: QGIS_FIELD_TYPES[field.type] ?? 'TEXT'
	};
}

function emptyProperties(fields: FormField[]): Record<string, unknown> {
	const props: Record<string, unknown> = {};
	for (const field of fields) {
		props[field.name] = null;
	}
	return props;
}

/** Columns from the boundary file that are kept (id and area already set on features' properties). */
function keptColumnDefs(keptColumns: ColumnConfig[]): { name: string; dataType: string }[] {
	return keptColumns
		.filter((c) => c.keep)
		.map((c) => ({ name: c.name, dataType: c.role === 'area' ? 'REAL' : 'TEXT' }));
}

export async function exportFormGpkg(config: FormProjectConfig): Promise<Uint8Array> {
	const keptCols = (config.keptColumns ?? []).filter((c) => c.keep);
	const keptColDefs = keptColumnDefs(config.keptColumns ?? []);

	// Column definitions: kept boundary columns first, then form fields
	const allColumnDefs = [
		...keptColDefs,
		...config.fields.map(fieldToColumnDef)
	];

	const plotFeatures: GeoJSON.Feature[] = config.boundaries.features.map((feature) => {
		const keptProps: Record<string, unknown> = {};
		for (const col of keptCols) {
			keptProps[col.name] = feature.properties?.[col.name] ?? null;
		}
		return {
			type: 'Feature',
			geometry: feature.geometry,
			properties: {
				...keptProps,
				...emptyProperties(config.fields)
			}
		};
	});

	const bounds = computeBoundingBox(plotFeatures);
	const ficFeatures = buildFicLookupFeatures(config.ficMappings);
	const multiselectFeatures = buildMultiselectOptFeatures(config.fields);
	const ficBounds = { minX: -1, minY: -1, maxX: 1, maxY: 1 };

	const geoPackage = await GeoPackageAPI.create();

	try {
		geoPackage.createRequiredTables();

		geoPackage.createFeatureTable(
			config.tableName,
			undefined,
			allColumnDefs,
			{
				minLongitude: bounds.minX,
				minLatitude: bounds.minY,
				maxLongitude: bounds.maxX,
				maxLatitude: bounds.maxY
			} as never,
			4326
		);

		geoPackage.createFeatureTable(
			FIC_LOOKUP_TABLE,
			undefined,
			[
				{ name: 'lateral', dataType: 'TEXT' },
				{ name: 'fic', dataType: 'TEXT' }
			],
			{
				minLongitude: ficBounds.minX,
				minLatitude: ficBounds.minY,
				maxLongitude: ficBounds.maxX,
				maxLatitude: ficBounds.maxY
			} as never,
			4326
		);

		// Multiselect options lookup table (only created when there are multiselect fields)
		geoPackage.createFeatureTable(
			MULTISELECT_OPTS_TABLE,
			undefined,
			[
				{ name: 'field_name', dataType: 'TEXT' },
				{ name: 'value', dataType: 'TEXT' },
				{ name: 'label', dataType: 'TEXT' }
			],
			{
				minLongitude: ficBounds.minX,
				minLatitude: ficBounds.minY,
				maxLongitude: ficBounds.maxX,
				maxLatitude: ficBounds.maxY
			} as never,
			4326
		);

		if (plotFeatures.length > 0) {
			await geoPackage.addGeoJSONFeaturesToGeoPackage(plotFeatures, config.tableName);
		}
		await geoPackage.addGeoJSONFeaturesToGeoPackage(ficFeatures, FIC_LOOKUP_TABLE);

		if (multiselectFeatures.length > 0) {
			await geoPackage.addGeoJSONFeaturesToGeoPackage(multiselectFeatures, MULTISELECT_OPTS_TABLE);
		}

		const exported = await geoPackage.export();
		return exported instanceof Uint8Array ? exported : new Uint8Array(exported);
	} finally {
		geoPackage.close();
	}
}
