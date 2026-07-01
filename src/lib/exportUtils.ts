import type { FarmFeatureProperties, ProcessedGeoJson } from './gpkgParser';
import {
	buildWaterColumnValues,
	collectWaterColumnNames,
	roundWaterValue
} from './waterBudget';

export const SKIP_EXPORT_KEYS = new Set(['waterSchedule', 'geom', 'geometry']);

export function waterExportBaseName(sourceFileName: string | null): string {
	if (!sourceFileName) return 'farm_water_export';
	return sourceFileName.replace(/\.gpkg$/i, '_water');
}

export function buildExportRow(
	properties: FarmFeatureProperties,
	waterColumns: string[]
): Record<string, unknown> {
	const exportProps: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(properties)) {
		if (SKIP_EXPORT_KEYS.has(key)) continue;
		exportProps[key] = value;
	}

	const waterValues = buildWaterColumnValues(properties.waterSchedule);
	let totalWater = 0;
	for (const column of waterColumns) {
		const val = column in waterValues ? waterValues[column] : null;
		exportProps[column] = val;
		if (val !== null) totalWater += val as number;
	}

	exportProps['total_water_mm'] = roundWaterValue(totalWater);
	return exportProps;
}

export function getOriginalColumnNames(features: ProcessedGeoJson['features']): string[] {
	const names: string[] = [];
	const seen = new Set<string>();

	for (const feature of features) {
		for (const key of Object.keys(feature.properties)) {
			if (SKIP_EXPORT_KEYS.has(key) || seen.has(key)) continue;
			seen.add(key);
			names.push(key);
		}
	}

	return names;
}

export function getExportColumnNames(features: ProcessedGeoJson['features']): string[] {
	const waterColumns = collectWaterColumnNames(features);
	return [...getOriginalColumnNames(features), ...waterColumns, 'total_water_mm'];
}

export function formatExportValue(value: unknown): string {
	if (value === null || value === undefined) return '';
	if (value instanceof Date) return value.toISOString();
	if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
	return String(value);
}

export function downloadBlob(blob: Blob, fileName: string): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = fileName;
	anchor.click();
	URL.revokeObjectURL(url);
}
