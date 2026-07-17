import { GeoPackageAPI } from '@ngageoint/geopackage';
import type { ProcessedGeoJson } from './gpkgParser';
import {
	buildExportRow,
	downloadBlob,
	getOriginalColumnNames,
	waterExportBaseName
} from './exportUtils';
import { collectWaterColumnNames } from './waterBudget';

function inferDataType(value: unknown): string {
	return typeof value === 'number' ? 'REAL' : 'TEXT';
}

function getOriginalColumnDefs(
	features: ProcessedGeoJson['features']
): Array<{ name: string; dataType: string }> {
	const typeMap = new Map<string, string>();

	for (const name of getOriginalColumnNames(features)) {
		typeMap.set(name, 'TEXT');
	}

	for (const feature of features) {
		for (const [key, value] of Object.entries(feature.properties)) {
			if (!typeMap.has(key)) continue;
			if (typeof value === 'number') {
				typeMap.set(key, 'REAL');
			}
		}
	}

	return [...typeMap.entries()].map(([name, dataType]) => ({ name, dataType }));
}

function computeBoundingBox(features: ProcessedGeoJson['features']) {
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

	return { minX, minY, maxX, maxY };
}

function extractCoordinates(geometry: GeoJSON.Geometry): number[][] {
	if (geometry.type === 'Point') {
		return [geometry.coordinates as number[]];
	}
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

export async function exportGpkgWithWaterData(
	geojson: ProcessedGeoJson,
	tableName: string
): Promise<Uint8Array> {
	const waterColumns = collectWaterColumnNames(geojson.features);
	const originalColumnDefs = getOriginalColumnDefs(geojson.features);

	const columnDefs = [
		...originalColumnDefs,
		...waterColumns.map((name) => ({ name, dataType: 'REAL' })),
		{ name: 'total_water_m3', dataType: 'REAL' }
	];

	const exportFeatures: GeoJSON.Feature[] = geojson.features.map((feature) => ({
		type: 'Feature',
		geometry: feature.geometry,
		properties: buildExportRow(feature.properties, waterColumns)
	}));

	const bounds = computeBoundingBox(geojson.features);
	const geoPackage = await GeoPackageAPI.create();

	try {
		geoPackage.createRequiredTables();
		geoPackage.createFeatureTable(
			tableName,
			undefined,
			columnDefs,
			{
				minLongitude: bounds.minX,
				minLatitude: bounds.minY,
				maxLongitude: bounds.maxX,
				maxLatitude: bounds.maxY
			} as never,
			4326
		);

		await geoPackage.addGeoJSONFeaturesToGeoPackage(exportFeatures, tableName);
		const exported = await geoPackage.export();
		return exported instanceof Uint8Array ? exported : new Uint8Array(exported);
	} finally {
		geoPackage.close();
	}
}

export function downloadGpkg(bytes: Uint8Array, fileName: string): void {
	const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
	const blob = new Blob([data], { type: 'application/geopackage+sqlite3' });
	downloadBlob(blob, fileName);
}

export function waterExportFileName(sourceFileName: string | null): string {
	return `${waterExportBaseName(sourceFileName)}.gpkg`;
}
