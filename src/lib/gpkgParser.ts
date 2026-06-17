import { GeoPackage, GeoPackageAPI } from '@ngageoint/geopackage';
import {
	calculateWaterSchedule,
	parseWaterBudgetCsv,
	type WaterSchedule
} from './waterBudget';

export interface FarmFeatureProperties {
	fid: number;
	Status?: string;
	Village?: string;
	FarmerName?: string;
	UniqueId?: string;
	'CROP_25-26'?: string;
	Mobile?: number;
	CROP_26_K?: string;
	Sowing_Date?: string;
	Potential_Sowing?: string;
	IR_Status?: string;
	Census_Date?: string;
	Acre?: number;
	waterSchedule?: WaterSchedule;
	[key: string]: unknown;
}

export interface ProcessedGeoJson {
	type: 'FeatureCollection';
	features: Array<{
		type: 'Feature';
		geometry: GeoJSON.Geometry;
		properties: FarmFeatureProperties;
	}>;
}

const REQUIRED_COLUMNS = ['CROP_26_K', 'Sowing_Date'];

function validateColumns(columnNames: string[]): void {
	const missing = REQUIRED_COLUMNS.filter(
		(col) => !columnNames.some((name) => name.toLowerCase() === col.toLowerCase())
	);
	if (missing.length > 0) {
		throw new Error(`GeoPackage is missing required columns: ${missing.join(', ')}`);
	}
}

function formatSowingDate(value: unknown): string {
	if (value instanceof Date) {
		return value.toISOString().slice(0, 10);
	}
	return String(value ?? '');
}

export async function parseGpkgFile(
	file: ArrayBuffer,
	budgetCsv: string
): Promise<ProcessedGeoJson> {
	const budget = parseWaterBudgetCsv(budgetCsv);
	const geoPackage = await GeoPackageAPI.open(new Uint8Array(file));

	try {
		const tableNames = geoPackage.getFeatureTables();
		if (tableNames.length === 0) {
			throw new Error('No feature tables found in GeoPackage.');
		}

		const tableName = tableNames[0];
		const featureDao = geoPackage.getFeatureDao(tableName);
		const columnNames = featureDao.columns;
		validateColumns(columnNames);

		const srs = featureDao.srs;
		const features: ProcessedGeoJson['features'] = [];

		for (const row of featureDao.queryForEach()) {
			if (!row) continue;

			const featureRow = featureDao.getRow(row);
			const geoJsonFeature = GeoPackage.parseFeatureRowIntoGeoJSON(featureRow, srs);

			if (!geoJsonFeature.geometry) continue;

			const rawProps = geoJsonFeature.properties ?? {};
			const crop = String(rawProps.CROP_26_K ?? '');
			const sowingDate = formatSowingDate(rawProps.Sowing_Date);
			const acres = Number(rawProps.Acre ?? 1);

			const properties: FarmFeatureProperties = {
				...rawProps,
				fid: Number(geoJsonFeature.id ?? featureRow.id),
				CROP_26_K: crop,
				Sowing_Date: sowingDate,
				Acre: acres,
				waterSchedule: calculateWaterSchedule(crop, sowingDate, budget, acres)
			};

			features.push({
				type: 'Feature',
				geometry: geoJsonFeature.geometry as GeoJSON.Geometry,
				properties
			});
		}

		if (features.length === 0) {
			throw new Error('No features could be read from the GeoPackage.');
		}

		return {
			type: 'FeatureCollection',
			features
		};
	} finally {
		geoPackage.close();
	}
}
