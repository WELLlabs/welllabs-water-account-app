import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { FarmFeatureProperties, ProcessedGeoJson } from './gpkgParser';
import { formatExportValue, SKIP_EXPORT_KEYS, waterExportBaseName, downloadBlob } from './exportUtils';
import {
	formatCalendarMonth,
	getExportableMonthNeeds,
	roundWaterValue
} from './waterBudget';
import {
	buildGroupStats,
	buildOverallStats,
	buildSubGroupStats,
	getGroupValue,
	type GroupStats,
	type ViewMode
} from './groupUtils';

export interface PdfExportOptions {
	viewMode: ViewMode;
	groupByColumn?: string;
	subGroupByColumn?: string;
}

type Ring = number[][];
type PolygonCoords = Ring[];
type MultiPolygonCoords = PolygonCoords[];

function extractPolygons(geometry: GeoJSON.Geometry): PolygonCoords[] {
	if (geometry.type === 'Polygon') {
		return [geometry.coordinates as PolygonCoords];
	}
	if (geometry.type === 'MultiPolygon') {
		return geometry.coordinates as MultiPolygonCoords;
	}
	return [];
}

function ringBounds(ring: Ring) {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const [x, y] of ring) {
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
	}
	return { minX, minY, maxX, maxY };
}

function computeGeoBounds(features: GeoJSON.Feature[]) {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;

	for (const feature of features) {
		if (!feature.geometry) continue;
		for (const polygon of extractPolygons(feature.geometry)) {
			for (const ring of polygon) {
				const b = ringBounds(ring);
				minX = Math.min(minX, b.minX);
				minY = Math.min(minY, b.minY);
				maxX = Math.max(maxX, b.maxX);
				maxY = Math.max(maxY, b.maxY);
			}
		}
	}

	return { minX, minY, maxX, maxY };
}

function hexToRgba(hex: string, alpha: number): string {
	const h = hex.replace('#', '');
	const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
	const n = Number.parseInt(full, 16);
	const r = (n >> 16) & 255;
	const g = (n >> 8) & 255;
	const b = n & 255;
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const DULL_STYLE = {
	fill: 'rgba(170, 175, 185, 0.14)',
	stroke: '#c5c9d1',
	lineWidth: 0.8
};

function selectedStyle(hex: string) {
	return {
		fill: hexToRgba(hex, 0.58),
		stroke: hex,
		lineWidth: 2.6
	};
}

type ColorFn = (feature: GeoJSON.Feature) => { fill: string; stroke: string; lineWidth: number };

function renderMapDataUrl(
	features: GeoJSON.Feature[],
	colorFor: ColorFn,
	width = 720,
	height = 320
): string {
	if (features.length === 0) return '';
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (!ctx) return '';

	const bounds = computeGeoBounds(features);
	if (!Number.isFinite(bounds.minX)) return '';

	const pad = 0.08;
	const dataW = bounds.maxX - bounds.minX || 1;
	const dataH = bounds.maxY - bounds.minY || 1;
	const scale = Math.min(
		(width * (1 - pad * 2)) / dataW,
		(height * (1 - pad * 2)) / dataH
	);
	const offsetX = (width - dataW * scale) / 2;
	const offsetY = (height - dataH * scale) / 2;

	const project = (x: number, y: number) => ({
		x: offsetX + (x - bounds.minX) * scale,
		y: height - (offsetY + (y - bounds.minY) * scale)
	});

	ctx.fillStyle = '#f8fafc';
	ctx.fillRect(0, 0, width, height);

	for (const feature of features) {
		if (!feature.geometry) continue;
		const colors = colorFor(feature);
		for (const polygon of extractPolygons(feature.geometry)) {
			for (const ring of polygon) {
				if (ring.length < 3) continue;
				ctx.beginPath();
				const start = project(ring[0][0], ring[0][1]);
				ctx.moveTo(start.x, start.y);
				for (let i = 1; i < ring.length; i++) {
					const p = project(ring[i][0], ring[i][1]);
					ctx.lineTo(p.x, p.y);
				}
				ctx.closePath();
				ctx.fillStyle = colors.fill;
				ctx.strokeStyle = colors.stroke;
				ctx.lineWidth = colors.lineWidth;
				ctx.fill();
				ctx.stroke();
			}
		}
	}

	return canvas.toDataURL('image/png');
}

function getDetailEntries(properties: FarmFeatureProperties): Array<[string, string]> {
	const entries: Array<[string, string]> = [];
	for (const [key, value] of Object.entries(properties)) {
		if (SKIP_EXPORT_KEYS.has(key)) continue;
		const formatted = formatExportValue(value);
		if (formatted === '') continue;
		entries.push([key, formatted]);
	}
	return entries;
}

function plotTitle(properties: FarmFeatureProperties): string {
	const parts = [
		properties.FarmerName ? String(properties.FarmerName) : null,
		properties.UniqueId ? String(properties.UniqueId) : null,
		properties.Village ? String(properties.Village) : null
	].filter(Boolean);
	return parts.length > 0 ? parts.join(' · ') : `Plot ${properties.fid}`;
}

function drawPageHeader(
	doc: jsPDF,
	title: string,
	subtitle: string,
	margin: number,
	metaLines: string[] = []
): number {
	doc.setFontSize(16);
	doc.setTextColor(15, 23, 42);
	doc.text(title, margin, 18);

	doc.setFontSize(11);
	doc.setTextColor(71, 85, 105);
	doc.text(subtitle, margin, 26);

	let y = 32;
	if (metaLines.length > 0) {
		doc.setFontSize(9);
		doc.setTextColor(100, 116, 139);
		for (const line of metaLines) {
			doc.text(line, margin, y);
			y += 5;
		}
		y += 2;
	}
	return y;
}

function drawMonthlyTable(
	doc: jsPDF,
	monthlyNeeds: GroupStats['monthlyNeeds'],
	startY: number,
	margin: number,
	extraHeadNote?: string
): void {
	let y = startY;
	doc.setFontSize(12);
	doc.setTextColor(30, 41, 59);
	doc.text('Monthly Water Requirements', margin, y);
	y += 4;

	if (extraHeadNote) {
		doc.setFontSize(9);
		doc.setTextColor(71, 85, 105);
		doc.text(extraHeadNote, margin, y + 4);
		y += 8;
	} else {
		y += 4;
	}

	if (monthlyNeeds.length === 0) {
		doc.setFontSize(9);
		doc.setTextColor(146, 64, 14);
		doc.text('No matched water budget for these plots.', margin, y + 2);
		return;
	}

	const total = monthlyNeeds.reduce((s, m) => s + m.waterM3, 0);
	const totalPerAcre = monthlyNeeds.reduce((s, m) => s + m.waterM3PerAcre, 0);

	autoTable(doc, {
		startY: y,
		margin: { left: margin, right: margin },
		head: [['Month', 'Water per acre (m³)', 'Total water (m³)']],
		body: monthlyNeeds.map((need) => [
			formatCalendarMonth(need.calendarMonth, need.calendarYear),
			roundWaterValue(need.waterM3PerAcre).toFixed(2),
			roundWaterValue(need.waterM3).toFixed(2)
		]),
		foot: [['Total', roundWaterValue(totalPerAcre).toFixed(2), roundWaterValue(total).toFixed(2)]],
		theme: 'grid',
		headStyles: { fillColor: [239, 246, 255], textColor: [30, 64, 175], fontStyle: 'bold' },
		footStyles: { fillColor: [248, 250, 252], textColor: [15, 23, 42], fontStyle: 'bold' },
		styles: { fontSize: 9, cellPadding: 2.5 },
		columnStyles: {
			0: { halign: 'left' },
			1: { halign: 'right' },
			2: { halign: 'right' }
		}
	});
}

function addImageIfPresent(
	doc: jsPDF,
	dataUrl: string,
	margin: number,
	y: number,
	pageWidth: number,
	mapHeight = 70
): number {
	if (!dataUrl) return y;
	const mapWidth = pageWidth - margin * 2;
	doc.addImage(dataUrl, 'PNG', margin, y, mapWidth, mapHeight);
	return y + mapHeight + 6;
}

function writePlotPages(doc: jsPDF, geojson: ProcessedGeoJson, margin: number, pageWidth: number) {
	for (let i = 0; i < geojson.features.length; i++) {
		const feature = geojson.features[i];
		const props = feature.properties as FarmFeatureProperties;
		if (i > 0) doc.addPage();

		drawPageHeader(doc, 'Farm Plot Details', plotTitle(props), margin);

		const fid = Number(props.fid);
		const mapDataUrl = renderMapDataUrl(geojson.features, (f) => {
			const fFid = Number((f.properties as FarmFeatureProperties).fid);
			const highlighted = fFid === fid;
			return highlighted ? selectedStyle('#facc15') : DULL_STYLE;
		});

		let y = addImageIfPresent(doc, mapDataUrl, margin, 32, pageWidth);

		doc.setFontSize(12);
		doc.setTextColor(30, 41, 59);
		doc.text('Plot attributes', margin, y);
		y += 6;

		const details = getDetailEntries(props);
		doc.setFontSize(9);
		for (const [label, value] of details) {
			if (y > 250) break;
			doc.setTextColor(100, 116, 139);
			doc.text(`${label}:`, margin, y);
			doc.setTextColor(15, 23, 42);
			const lines = doc.splitTextToSize(value, pageWidth - margin * 2 - 40);
			doc.text(lines, margin + 38, y);
			y += Math.max(5, lines.length * 4.5);
		}

		y += 4;
		const schedule = props.waterSchedule;
		if (schedule?.matchedBudget) {
			const needs = getExportableMonthNeeds(schedule).map((n) => ({
				calendarMonth: n.calendarMonth,
				calendarYear: n.calendarYear,
				waterM3: n.waterM3,
				waterM3PerAcre: n.waterM3PerAcre
			}));
			drawMonthlyTable(
				doc,
				needs,
				y,
				margin,
				`Season: ${schedule.season} · Area: ${schedule.acres.toFixed(2)} acres`
			);
		} else if (schedule) {
			doc.setFontSize(9);
			doc.setTextColor(146, 64, 14);
			doc.text(schedule.note ?? 'Unable to calculate water budget.', margin, y + 6);
		}
	}
}

function writeGroupExport(
	doc: jsPDF,
	geojson: ProcessedGeoJson,
	groupByColumn: string,
	margin: number,
	pageWidth: number
) {
	const { groups, colorByKey } = buildGroupStats(geojson.features, groupByColumn);
	const overall = buildOverallStats(geojson.features, groups.length);

	// Overview
	let y = drawPageHeader(
		doc,
		'Groups overview',
		`Grouped by ${groupByColumn}`,
		margin,
		[
			`Groups: ${groups.length} · Plots: ${overall.plotCount} · Area: ${overall.totalAcres.toFixed(2)} acres`,
			`Total water: ${overall.totalWaterM3.toFixed(2)} m³`
		]
	);

	const overviewMap = renderMapDataUrl(geojson.features, () => DULL_STYLE);
	y = addImageIfPresent(doc, overviewMap, margin, y, pageWidth, 65);

	autoTable(doc, {
		startY: y,
		margin: { left: margin, right: margin },
		head: [['Group', 'Plots', 'Acres', 'Water (m³)', 'Crops']],
		body: groups.map((g) => [
			g.label,
			String(g.plotCount),
			g.totalAcres.toFixed(2),
			g.totalWaterM3.toFixed(2),
			g.crops.join(', ') || '—'
		]),
		theme: 'grid',
		headStyles: { fillColor: [239, 246, 255], textColor: [30, 64, 175], fontStyle: 'bold' },
		styles: { fontSize: 8, cellPadding: 2 },
		columnStyles: {
			1: { halign: 'right' },
			2: { halign: 'right' },
			3: { halign: 'right' }
		}
	});

	// One page per group
	for (const group of groups) {
		doc.addPage();
		y = drawPageHeader(
			doc,
			`Group: ${group.label}`,
			`Grouped by ${groupByColumn}`,
			margin,
			[
				`Plots: ${group.plotCount} · Acres: ${group.totalAcres.toFixed(2)} · Water: ${group.totalWaterM3.toFixed(2)} m³`,
				group.crops.length ? `Crops: ${group.crops.join(', ')}` : ''
			].filter(Boolean)
		);

		const map = renderMapDataUrl(geojson.features, (f) => {
			const key = getGroupValue(f, groupByColumn);
			const inGroup = key === group.key;
			const color = colorByKey.get(key) ?? '#1b75e0';
			return inGroup ? selectedStyle(color) : DULL_STYLE;
		});
		y = addImageIfPresent(doc, map, margin, y, pageWidth);
		drawMonthlyTable(doc, group.monthlyNeeds, y, margin);
	}
}

function writeSubGroupExport(
	doc: jsPDF,
	geojson: ProcessedGeoJson,
	groupByColumn: string,
	subGroupByColumn: string,
	margin: number,
	pageWidth: number
) {
	const { groups: parents, colorByKey: parentColors } = buildGroupStats(
		geojson.features,
		groupByColumn
	);

	const nested: Array<{ parent: GroupStats; subs: GroupStats[] }> = parents.map((parent) => ({
		parent,
		subs: buildSubGroupStats(geojson.features, groupByColumn, parent.key, subGroupByColumn)
			.groups
	}));

	const overall = buildOverallStats(geojson.features, parents.length);
	const subCount = nested.reduce((s, n) => s + n.subs.length, 0);

	let y = drawPageHeader(
		doc,
		'Sub-groups overview',
		`Group by ${groupByColumn} · Then by ${subGroupByColumn}`,
		margin,
		[
			`Groups: ${parents.length} · Sub-groups: ${subCount} · Plots: ${overall.plotCount}`,
			`Area: ${overall.totalAcres.toFixed(2)} acres · Water: ${overall.totalWaterM3.toFixed(2)} m³`
		]
	);

	const overviewMap = renderMapDataUrl(geojson.features, () => DULL_STYLE);
	y = addImageIfPresent(doc, overviewMap, margin, y, pageWidth, 55);

	const overviewRows: string[][] = [];
	for (const { parent, subs } of nested) {
		overviewRows.push([
			parent.label,
			'(all)',
			String(parent.plotCount),
			parent.totalAcres.toFixed(2),
			parent.totalWaterM3.toFixed(2)
		]);
		for (const sub of subs) {
			overviewRows.push([
				parent.label,
				sub.label,
				String(sub.plotCount),
				sub.totalAcres.toFixed(2),
				sub.totalWaterM3.toFixed(2)
			]);
		}
	}

	autoTable(doc, {
		startY: y,
		margin: { left: margin, right: margin },
		head: [[groupByColumn, subGroupByColumn, 'Plots', 'Acres', 'Water (m³)']],
		body: overviewRows,
		theme: 'grid',
		headStyles: { fillColor: [239, 246, 255], textColor: [30, 64, 175], fontStyle: 'bold' },
		styles: { fontSize: 8, cellPadding: 2 },
		columnStyles: {
			2: { halign: 'right' },
			3: { halign: 'right' },
			4: { halign: 'right' }
		}
	});

	for (const { parent, subs } of nested) {
		const { colorByKey: subColors } = buildSubGroupStats(
			geojson.features,
			groupByColumn,
			parent.key,
			subGroupByColumn
		);

		for (const sub of subs) {
			doc.addPage();
			y = drawPageHeader(
				doc,
				`Sub-group: ${sub.label}`,
				`${groupByColumn}: ${parent.label} · ${subGroupByColumn}: ${sub.label}`,
				margin,
				[
					`Plots: ${sub.plotCount} · Acres: ${sub.totalAcres.toFixed(2)} · Water: ${sub.totalWaterM3.toFixed(2)} m³`,
					sub.crops.length ? `Crops: ${sub.crops.join(', ')}` : ''
				].filter(Boolean)
			);

			const map = renderMapDataUrl(geojson.features, (f) => {
				const parentKey = getGroupValue(f, groupByColumn);
				const subKey = getGroupValue(f, subGroupByColumn);
				const match = parentKey === parent.key && subKey === sub.key;
				const color = subColors.get(subKey) ?? parentColors.get(parentKey) ?? '#1b75e0';
				return match ? selectedStyle(color) : DULL_STYLE;
			});
			y = addImageIfPresent(doc, map, margin, y, pageWidth);
			drawMonthlyTable(doc, sub.monthlyNeeds, y, margin);
		}
	}
}

function writeOverallExport(
	doc: jsPDF,
	geojson: ProcessedGeoJson,
	margin: number,
	pageWidth: number
) {
	const overall = buildOverallStats(geojson.features);
	let y = drawPageHeader(
		doc,
		'Farm overall',
		'All plots combined',
		margin,
		[
			`Plots: ${overall.plotCount} · Area: ${overall.totalAcres.toFixed(2)} acres`,
			`Matched budgets: ${overall.matchedCount} · Total water: ${overall.totalWaterM3.toFixed(2)} m³`
		]
	);

	const map = renderMapDataUrl(geojson.features, () => selectedStyle('#60a5fa'));
	y = addImageIfPresent(doc, map, margin, y, pageWidth);
	drawMonthlyTable(doc, overall.monthlyNeeds, y, margin);
}

export async function exportPdf(
	geojson: ProcessedGeoJson,
	options: PdfExportOptions = { viewMode: 'plot' }
): Promise<Blob> {
	const doc = new jsPDF({ unit: 'mm', format: 'a4' });
	const pageWidth = doc.internal.pageSize.getWidth();
	const margin = 14;
	const { viewMode, groupByColumn = '', subGroupByColumn = '' } = options;

	if (viewMode === 'group') {
		if (!groupByColumn) {
			throw new Error('Select a Group by column before exporting Groups.');
		}
		writeGroupExport(doc, geojson, groupByColumn, margin, pageWidth);
	} else if (viewMode === 'subgroup') {
		if (!groupByColumn || !subGroupByColumn) {
			throw new Error('Select Group by and Then by columns before exporting Sub-groups.');
		}
		writeSubGroupExport(doc, geojson, groupByColumn, subGroupByColumn, margin, pageWidth);
	} else if (viewMode === 'overall') {
		writeOverallExport(doc, geojson, margin, pageWidth);
	} else {
		writePlotPages(doc, geojson, margin, pageWidth);
	}

	return doc.output('blob');
}

export async function downloadPdf(
	geojson: ProcessedGeoJson,
	sourceFileName: string | null,
	options: PdfExportOptions = { viewMode: 'plot' }
): Promise<void> {
	const blob = await exportPdf(geojson, options);
	const modeSuffix =
		options.viewMode === 'group'
			? '_groups'
			: options.viewMode === 'subgroup'
				? '_subgroups'
				: options.viewMode === 'overall'
					? '_overall'
					: '_plots';
	downloadBlob(blob, `${waterExportBaseName(sourceFileName)}${modeSuffix}.pdf`);
}
