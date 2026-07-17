import { GeoPackage, GeoPackageAPI } from '@ngageoint/geopackage';
import {
	calculateWaterSchedule,
	calculateWaterScheduleBySeason,
	normalizeSowingDateInput,
	parseWaterBudgetCsv,
	type CropSeason,
	type WaterSchedule
} from './waterBudget';

export type { CropSeason } from './waterBudget';

export interface ParseOptions {
	cropColumn: string;
	sowingDateColumn: string;
	fallbackSeason: CropSeason | '';
	acresColumn: string;
	defaultAcres: number;
}

export interface FarmFeatureProperties {
	fid: number;
	crop: string;
	sowingDate: string;
	acres: number;
	waterSchedule?: WaterSchedule;
	[key: string]: unknown;
}

export interface ProcessedGeoJson {
	type: 'FeatureCollection';
	tableName: string;
	features: Array<{
		type: 'Feature';
		geometry: GeoJSON.Geometry;
		properties: FarmFeatureProperties;
	}>;
}

const GEOMETRY_COLUMNS = new Set(['geom', 'geometry']);

function findColumn(columns: string[], candidates: string[]): string | null {
	for (const candidate of candidates) {
		const match = columns.find((name) => name.toLowerCase() === candidate.toLowerCase());
		if (match) return match;
	}
	return null;
}

function getAttributeColumns(columns: string[]): string[] {
	return columns.filter((name) => !GEOMETRY_COLUMNS.has(name.toLowerCase()));
}

function getPropertyValue(props: Record<string, unknown>, column: string): unknown {
	if (!column) return undefined;
	const direct = props[column];
	if (direct !== undefined) return direct;

	const match = Object.keys(props).find((key) => key.toLowerCase() === column.toLowerCase());
	return match ? props[match] : undefined;
}

function formatSowingDate(value: unknown): string {
	return normalizeSowingDateInput(value);
}

async function openFeatureDao(file: ArrayBuffer) {
	const geoPackage = await GeoPackageAPI.open(new Uint8Array(file));
	const tableNames = geoPackage.getFeatureTables();
	if (tableNames.length === 0) {
		geoPackage.close();
		throw new Error('No feature tables found in GeoPackage.');
	}

	return {
		geoPackage,
		featureDao: geoPackage.getFeatureDao(tableNames[0])
	};
}

export async function getGpkgColumnNames(file: ArrayBuffer): Promise<string[]> {
	const { geoPackage, featureDao } = await openFeatureDao(file);
	try {
		return getAttributeColumns(featureDao.columns);
	} finally {
		geoPackage.close();
	}
}

export function guessDefaultColumns(columns: string[]): Pick<ParseOptions, 'cropColumn' | 'sowingDateColumn' | 'acresColumn'> {
	const cropColumn =
		findColumn(columns, ['CROP_26_K', 'CROP_26', 'CROP', 'Crop']) ??
		columns.find((name) => /crop/i.test(name)) ??
		columns[0] ??
		'';

	const sowingDateColumn =
		findColumn(columns, ['Sowing_Date', 'SowingDate', 'Sowing Date', 'sowing_date']) ??
		columns.find((name) => /sowing/i.test(name)) ??
		'';

	const acresColumn =
		findColumn(columns, ['Acre', 'Acres', 'AREA', 'Area']) ??
		columns.find((name) => /acre|area/i.test(name)) ??
		'';

	return { cropColumn, sowingDateColumn, acresColumn };
}

function validateParseOptions(columnNames: string[], options: ParseOptions): void {
	const attributeColumns = getAttributeColumns(columnNames);
	const missing: string[] = [];

	if (!options.cropColumn) {
		missing.push('crop column');
	} else if (!attributeColumns.some((name) => name.toLowerCase() === options.cropColumn.toLowerCase())) {
		missing.push(`crop column "${options.cropColumn}"`);
	}

	if (options.sowingDateColumn) {
		if (!attributeColumns.some((name) => name.toLowerCase() === options.sowingDateColumn.toLowerCase())) {
			missing.push(`sowing date column "${options.sowingDateColumn}"`);
		}
	} else if (!options.fallbackSeason) {
		missing.push('sowing date column or fallback season (Kharif/Rabi)');
	}

	if (
		options.acresColumn &&
		!attributeColumns.some((name) => name.toLowerCase() === options.acresColumn.toLowerCase())
	) {
		missing.push(`acres column "${options.acresColumn}"`);
	}

	if (!options.acresColumn && !(Number.isFinite(options.defaultAcres) && options.defaultAcres > 0)) {
		missing.push('default area in acres');
	}

	if (missing.length > 0) {
		throw new Error(`Invalid configuration: ${missing.join(', ')}`);
	}
}

function resolveAcres(
	rawProps: Record<string, unknown>,
	acresColumn: string,
	defaultAcres: number
): number {
	if (acresColumn) {
		const rawAcres = Number(getPropertyValue(rawProps, acresColumn));
		if (Number.isFinite(rawAcres) && rawAcres > 0) return rawAcres;
		return defaultAcres;
	}

	return defaultAcres;
}

function buildWaterSchedule(
	crop: string,
	sowingDate: string,
	fallbackSeason: CropSeason | '',
	budget: ReturnType<typeof parseWaterBudgetCsv>,
	acres: number
): WaterSchedule {
	if (sowingDate.trim()) {
		return calculateWaterSchedule(crop, sowingDate, budget, acres);
	}

	return calculateWaterScheduleBySeason(crop, fallbackSeason as CropSeason, budget, acres);
}

export async function parseGpkgFile(
	file: ArrayBuffer,
	budgetCsv: string,
	options: ParseOptions
): Promise<ProcessedGeoJson> {
	const { geoPackage, featureDao } = await openFeatureDao(file);

	try {
		validateParseOptions(featureDao.columns, options);

		const srs = featureDao.srs;
		const rawFeatures: GeoJSON.Feature[] = [];

		for (const row of featureDao.queryForEach()) {
			if (!row) continue;

			const featureRow = featureDao.getRow(row);
			const geoJsonFeature = GeoPackage.parseFeatureRowIntoGeoJSON(featureRow, srs);

			if (!geoJsonFeature.geometry) continue;

			rawFeatures.push({
				type: 'Feature',
				id: geoJsonFeature.id ?? featureRow.id,
				geometry: geoJsonFeature.geometry as GeoJSON.Geometry,
				properties: (geoJsonFeature.properties ?? {}) as Record<string, unknown>
			});
		}

		if (rawFeatures.length === 0) {
			throw new Error('No features could be read from the GeoPackage.');
		}

		const tableName = geoPackage.getFeatureTables()[0];
		return enrichFeatureCollection(
			{ type: 'FeatureCollection', features: rawFeatures },
			tableName,
			budgetCsv,
			options
		);
	} finally {
		geoPackage.close();
	}
}

/** Column names from a FeatureCollection (attribute keys only). */
export function getGeoJsonColumnNames(fc: GeoJSON.FeatureCollection): string[] {
	const keys = new Set<string>();
	for (const f of fc.features) {
		if (!f.properties) continue;
		for (const k of Object.keys(f.properties)) {
			if (!GEOMETRY_COLUMNS.has(k.toLowerCase())) keys.add(k);
		}
	}
	return Array.from(keys);
}

/**
 * Attach crop/sowing/acres + water schedules to an already-loaded FeatureCollection
 * (used for both GeoPackage and shapefile inputs).
 */
export function enrichFeatureCollection(
	fc: GeoJSON.FeatureCollection,
	tableName: string,
	budgetCsv: string,
	options: ParseOptions
): ProcessedGeoJson {
	const budget = parseWaterBudgetCsv(budgetCsv);
	const columnNames = getGeoJsonColumnNames(fc);
	validateParseOptions(columnNames, options);

	const defaultAcres =
		Number.isFinite(options.defaultAcres) && options.defaultAcres > 0 ? options.defaultAcres : 1;

	const features: ProcessedGeoJson['features'] = [];

	fc.features.forEach((feature, index) => {
		if (!feature.geometry) return;

		const rawProps = (feature.properties ?? {}) as Record<string, unknown>;
		const crop = String(getPropertyValue(rawProps, options.cropColumn) ?? '');
		const sowingDate = options.sowingDateColumn
			? formatSowingDate(getPropertyValue(rawProps, options.sowingDateColumn))
			: '';
		const acres = resolveAcres(rawProps, options.acresColumn, defaultAcres);

		const fid =
			typeof feature.id === 'number'
				? feature.id
				: Number(rawProps.fid ?? rawProps.FID ?? index + 1);

		features.push({
			type: 'Feature',
			geometry: feature.geometry,
			properties: {
				...rawProps,
				fid: Number.isFinite(fid) ? fid : index + 1,
				crop,
				sowingDate,
				acres,
				waterSchedule: buildWaterSchedule(
					crop,
					sowingDate,
					options.fallbackSeason,
					budget,
					acres
				)
			}
		});
	});

	if (features.length === 0) {
		throw new Error('No features could be processed.');
	}

	return {
		type: 'FeatureCollection',
		tableName,
		features
	};
}
