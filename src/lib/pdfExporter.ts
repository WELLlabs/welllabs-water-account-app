import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { FarmFeatureProperties, ProcessedGeoJson } from './gpkgParser';
import { formatExportValue, SKIP_EXPORT_KEYS, waterExportBaseName, downloadBlob } from './exportUtils';
import {
	formatCalendarMonth,
	getExportableMonthNeeds,
	roundWaterValue
} from './waterBudget';

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

function computeGeoBounds(features: ProcessedGeoJson['features']) {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;

	for (const feature of features) {
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

function renderPlotMapDataUrl(
	geojson: ProcessedGeoJson,
	highlightedFid: number,
	width = 720,
	height = 320
): string {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (!ctx) return '';

	const bounds = computeGeoBounds(geojson.features);
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

	for (const feature of geojson.features) {
		const fid = Number((feature.properties as FarmFeatureProperties).fid);
		const highlighted = fid === highlightedFid;

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
				ctx.fillStyle = highlighted ? 'rgba(59, 130, 246, 0.55)' : 'rgba(96, 165, 250, 0.35)';
				ctx.strokeStyle = highlighted ? '#1d4ed8' : '#2563eb';
				ctx.lineWidth = highlighted ? 2.5 : 1.5;
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

export async function exportPdf(geojson: ProcessedGeoJson): Promise<Blob> {
	const doc = new jsPDF({ unit: 'mm', format: 'a4' });
	const pageWidth = doc.internal.pageSize.getWidth();
	const margin = 14;

	for (let i = 0; i < geojson.features.length; i++) {
		const feature = geojson.features[i];
		const props = feature.properties as FarmFeatureProperties;

		if (i > 0) doc.addPage();

		doc.setFontSize(16);
		doc.setTextColor(15, 23, 42);
		doc.text('Farm Plot Details', margin, 18);

		doc.setFontSize(11);
		doc.setTextColor(71, 85, 105);
		doc.text(plotTitle(props), margin, 26);

		const mapDataUrl = renderPlotMapDataUrl(geojson, props.fid);
		if (mapDataUrl) {
			const mapWidth = pageWidth - margin * 2;
			const mapHeight = 70;
			doc.addImage(mapDataUrl, 'PNG', margin, 32, mapWidth, mapHeight);
		}

		let y = mapDataUrl ? 108 : 34;

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
		doc.setFontSize(12);
		doc.setTextColor(30, 41, 59);
		doc.text('Monthly Water Requirements', margin, y);
		y += 4;

		const schedule = props.waterSchedule;
		if (schedule?.matchedBudget) {
			const needs = getExportableMonthNeeds(schedule);
			const totalPerAcre = needs.reduce((sum, item) => sum + item.waterMmPerAcre, 0);
			const total = totalPerAcre * schedule.acres;

			doc.setFontSize(9);
			doc.setTextColor(71, 85, 105);
			doc.text(
				`Season: ${schedule.season} · Area: ${schedule.acres.toFixed(2)} acres`,
				margin,
				y + 4
			);
			y += 8;

			autoTable(doc, {
				startY: y,
				margin: { left: margin, right: margin },
				head: [['Month', 'Water per acre (mm)', 'Total water (mm)']],
				body: needs.map((need) => [
					formatCalendarMonth(need.calendarMonth, need.calendarYear),
					roundWaterValue(need.waterMmPerAcre).toFixed(2),
					roundWaterValue(need.waterMm).toFixed(2)
				]),
				foot: [
					[
						'Total',
						roundWaterValue(totalPerAcre).toFixed(2),
						roundWaterValue(total).toFixed(2)
					]
				],
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
		} else if (schedule) {
			doc.setFontSize(9);
			doc.setTextColor(146, 64, 14);
			doc.text(schedule.note ?? 'Unable to calculate water budget.', margin, y + 6);
		}
	}

	return doc.output('blob');
}

export async function downloadPdf(
	geojson: ProcessedGeoJson,
	sourceFileName: string | null
): Promise<void> {
	const blob = await exportPdf(geojson);
	downloadBlob(blob, `${waterExportBaseName(sourceFileName)}.pdf`);
}
