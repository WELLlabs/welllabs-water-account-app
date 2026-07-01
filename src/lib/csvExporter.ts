import type { ProcessedGeoJson } from './gpkgParser';
import {
	buildExportRow,
	downloadBlob,
	formatExportValue,
	getExportColumnNames,
	waterExportBaseName
} from './exportUtils';
import { collectWaterColumnNames } from './waterBudget';

function escapeCsvField(value: string): string {
	if (/[",\n\r]/.test(value)) {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return value;
}

export function exportCsv(geojson: ProcessedGeoJson): string {
	const waterColumns = collectWaterColumnNames(geojson.features);
	const columns = getExportColumnNames(geojson.features);
	const rows = geojson.features.map((feature) =>
		buildExportRow(feature.properties, waterColumns)
	);

	const header = columns.map(escapeCsvField).join(',');
	const body = rows
		.map((row) =>
			columns.map((col) => escapeCsvField(formatExportValue(row[col]))).join(',')
		)
		.join('\n');

	return `${header}\n${body}`;
}

export function downloadCsv(geojson: ProcessedGeoJson, sourceFileName: string | null): void {
	const csv = exportCsv(geojson);
	const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
	downloadBlob(blob, `${waterExportBaseName(sourceFileName)}.csv`);
}
