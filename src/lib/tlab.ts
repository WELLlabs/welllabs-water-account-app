export type AluType = 'field' | 'dug_well' | 'farm_pond' | 'other_water' | 'trees';

export interface MonitoringPrediction {
	start_timestamp_sec: number;
	end_timestamp_sec: number;
	crop_1?: string;
	conf_1?: number;
	crop_2?: string;
	conf_2?: number;
	crop_3?: string;
	conf_3?: number;
}

export interface AgriFeatureProperties {
	alu_type: AluType | string;
	area_sq_m?: number;
	class_confidence?: number;
	capture_timestamp_sec?: number;
	monitoring_prediction?: MonitoringPrediction[];
}

export type AgriFeature = GeoJSON.Feature<GeoJSON.Geometry, AgriFeatureProperties>;

export interface AgriCellResponse {
	type: 'FeatureCollection';
	cellId: string;
	captureDate: string | null;
	dataVersion: { version?: string } | null;
	includeNonAgriculturalAreas: boolean;
	warnings: string[];
	features: AgriFeature[];
}

export interface LayerDef {
	type: AluType;
	label: string;
	singular: string;
	color: string;
}

export const LAYERS: LayerDef[] = [
	{ type: 'field', label: 'Farm plots', singular: 'Farm plot', color: '#facc15' },
	{ type: 'dug_well', label: 'Dug wells', singular: 'Dug well', color: '#ef4444' },
	{ type: 'farm_pond', label: 'Farm ponds', singular: 'Farm pond', color: '#06b6d4' },
	{ type: 'other_water', label: 'Other water bodies', singular: 'Water body', color: '#3b82f6' },
	{ type: 'trees', label: 'Trees', singular: 'Tree cover', color: '#22c55e' }
];

export const LAYER_BY_TYPE: Record<string, LayerDef> = Object.fromEntries(
	LAYERS.map((l) => [l.type, l])
);

const SQ_M_PER_ACRE = 4046.8564224;

export function formatArea(sqM: number | undefined): string {
	if (sqM == null || !Number.isFinite(sqM)) return '—';
	const acres = sqM / SQ_M_PER_ACRE;
	return `${Math.round(sqM).toLocaleString('en-IN')} m² (${acres < 10 ? acres.toFixed(2) : acres.toFixed(1)} ac)`;
}

export function geometryCenter(geom: GeoJSON.Geometry): [number, number] | null {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	const visit = (c: unknown): void => {
		if (Array.isArray(c) && typeof c[0] === 'number') {
			const [x, y] = c as [number, number];
			minX = Math.min(minX, x);
			maxX = Math.max(maxX, x);
			minY = Math.min(minY, y);
			maxY = Math.max(maxY, y);
		} else if (Array.isArray(c)) {
			c.forEach(visit);
		}
	};
	if ('coordinates' in geom) visit(geom.coordinates);
	if (!Number.isFinite(minX)) return null;
	return [(minY + maxY) / 2, (minX + maxX) / 2];
}

export function formatAcres(sqM: number): string {
	const acres = sqM / SQ_M_PER_ACRE;
	return `${acres < 10 ? acres.toFixed(2) : Math.round(acres).toLocaleString('en-IN')} ac`;
}

export function formatDate(sec: number | undefined): string {
	if (!sec) return '—';
	return new Date(sec * 1000).toLocaleDateString('en-IN', {
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});
}

export function formatPct(v: number | undefined): string {
	if (v == null || !Number.isFinite(v)) return '—';
	return `${Math.round(v * 100)}%`;
}

export function formatCrop(name: string | undefined): string {
	if (!name) return '—';
	if (name === 'UNKNOWN_CROP') return 'Unknown';
	return name
		.toLowerCase()
		.split('_')
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ');
}

const CROP_COLORS: Record<string, string> = {
	BAJRA: '#d97706',
	CHILLI: '#dc2626',
	COTTON: '#a78bfa',
	CORN: '#facc15',
	RICE: '#16a34a',
	GRAM: '#92400e',
	SORGHUM: '#db2777',
	GROUNDNUT: '#0d9488',
	SUGARCANE: '#65a30d',
	WHEAT: '#eab308',
	TUR: '#7c3aed',
	SUNFLOWER: '#fbbf24',
	UNKNOWN_CROP: '#94a3b8',
	NO_PREDICTION: '#cbd5e1'
};

const FALLBACK_COLORS = ['#0ea5e9', '#14b8a6', '#ec4899', '#8b5cf6', '#f43f5e', '#84cc16', '#06b6d4'];

export const UNCERTAIN_COLOR = '#e2e8f0';

export function cropColor(crop: string): string {
	if (CROP_COLORS[crop]) return CROP_COLORS[crop];
	let h = 0;
	for (const c of crop) h = (h * 31 + c.charCodeAt(0)) >>> 0;
	return FALLBACK_COLORS[h % FALLBACK_COLORS.length];
}

export function formatCropLabel(crop: string): string {
	if (crop === 'NO_PREDICTION') return 'No prediction';
	return formatCrop(crop);
}

/** Indian cropping season from the season's start date: Kharif (Jun–Sep), Rabi (Oct–Jan), Summer (Feb–May) */
export function seasonLabel(startSec: number): { season: string; year: string } {
	const d = new Date(startSec * 1000);
	const m = d.getMonth();
	const y = d.getFullYear();
	if (m >= 5 && m <= 8) return { season: 'Kharif', year: String(y) };
	if (m >= 9) return { season: 'Rabi', year: `${y}–${String(y + 1).slice(2)}` };
	if (m === 0) return { season: 'Rabi', year: `${y - 1}–${String(y).slice(2)}` };
	return { season: 'Summer', year: String(y) };
}

export interface SeasonSegment {
	crop: string;
	conf: number;
}

export interface SeasonBar {
	startSec: number;
	endSec: number;
	season: string;
	year: string;
	segments: SeasonSegment[];
	uncertain: number;
}

export function seasonBars(preds: MonitoringPrediction[] | undefined): SeasonBar[] {
	return [...(preds ?? [])]
		.sort((a, b) => a.start_timestamp_sec - b.start_timestamp_sec)
		.map((p) => {
			const segments: SeasonSegment[] = [];
			for (const i of [1, 2, 3] as const) {
				const crop = p[`crop_${i}`];
				const conf = p[`conf_${i}`];
				if (crop && conf != null && conf > 0) segments.push({ crop, conf });
			}
			const total = segments.reduce((s, x) => s + x.conf, 0);
			return {
				startSec: p.start_timestamp_sec,
				endSec: p.end_timestamp_sec,
				...seasonLabel(p.start_timestamp_sec),
				segments,
				uncertain: Math.max(0, 1 - total)
			};
		});
}

/** Project files kept with the old DpRVI build (the WUCS boundary lives here) */
export const DPRVI_BASE = '/tlab/dprvi';

function hexRgb(hex: string): [number, number, number] {
	const n = parseInt(hex.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export type GreyPixels = { width: number; height: number; data: Uint8Array };

/** RGBA lookup for an 8-bit grey raster: 256 entries, alpha 0 where `color` returns null */
export function byteLut(color: (byte: number) => string | null): Uint8ClampedArray {
	const lut = new Uint8ClampedArray(256 * 4);
	for (let b = 0; b < 256; b++) {
		const c = color(b);
		if (!c) continue;
		const [r, g, bl] = hexRgb(c);
		lut.set([r, g, bl, 255], b * 4);
	}
	return lut;
}

/** Load an 8-bit grey PNG and return its raw byte per pixel */
export async function loadGreyPixels(url: string): Promise<GreyPixels> {
	const img = new Image();
	img.decoding = 'async';
	img.src = url;
	await img.decode();
	const canvas = document.createElement('canvas');
	canvas.width = img.naturalWidth;
	canvas.height = img.naturalHeight;
	const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
	ctx.drawImage(img, 0, 0);
	const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
	const data = new Uint8Array(canvas.width * canvas.height);
	for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4];
	return { width: canvas.width, height: canvas.height, data };
}

export function colorizeGrey(px: GreyPixels, lut: Uint8ClampedArray): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = px.width;
	canvas.height = px.height;
	const ctx = canvas.getContext('2d')!;
	const img = ctx.createImageData(px.width, px.height);
	for (let i = 0; i < px.data.length; i++) {
		const o = px.data[i] * 4;
		img.data.set(lut.subarray(o, o + 4), i * 4);
	}
	ctx.putImageData(img, 0, 0);
	return canvas;
}

/** India-WRIS canal hierarchy codes in Raichur_Canal.gpkg */
export const CANAL_TYPES: Record<number, { label: string; weight: number; color: string }> = {
	1: { label: 'Main canal', weight: 4, color: '#0369a1' },
	2: { label: 'Branch canal', weight: 3.2, color: '#0284c7' },
	3: { label: 'Distributary', weight: 2.4, color: '#0ea5e9' },
	4: { label: 'Minor', weight: 1.6, color: '#38bdf8' },
	5: { label: 'Sub-minor', weight: 1.1, color: '#7dd3fc' },
	6: { label: 'Other channel', weight: 1.1, color: '#7dd3fc' }
};

export function canalStyle(type: number) {
	return CANAL_TYPES[type] ?? { label: 'Canal', weight: 1.2, color: '#38bdf8' };
}

/** NRSC NHP actual evapotranspiration, monthly mean of daily SNPP-VIIRS energy balance (750 m) */
export const ET_WMS = 'https://bhuvan.nrsc.gov.in/nhpgs/nhp_evapotranspiration/wms';

export function etLayerName(month: string): string {
	return `nhp_evapotranspiration:AET_SNPP_N_EB_MN_${month.replace('-', '')}`;
}

/** Class colours from the layer's SLD, one per 1 mm/day band from 0 to 10 */
export const ET_COLORS = [
	'#FFFFA0',
	'#FFFF78',
	'#C0F766',
	'#84ED48',
	'#47DE31',
	'#58B660',
	'#3CAB80',
	'#2595A9',
	'#26659A',
	'#203A77'
];

export type EtStatus = 'ok' | 'cloud' | 'nodata' | 'missing' | 'error';

export interface EtPoint {
	month: string;
	value: number | null;
	status: EtStatus;
}

type LatLngBox = [[number, number], [number, number]];

function wmsImageUrl(base: string, layer: string, bounds: LatLngBox, width: number, extra: Record<string, string> = {}) {
	const [[s, w], [n, e]] = bounds;
	const height = Math.max(1, Math.round((width * (n - s)) / (e - w)));
	const params = new URLSearchParams({
		...extra,
		SERVICE: 'WMS',
		VERSION: '1.1.1',
		REQUEST: 'GetMap',
		LAYERS: layer,
		STYLES: '',
		SRS: 'EPSG:4326',
		BBOX: [w, s, e, n].map((v) => v.toFixed(5)).join(','),
		WIDTH: String(width),
		HEIGHT: String(height),
		FORMAT: 'image/png',
		TRANSPARENT: 'true'
	});
	return `${base}?${params}`;
}

export function etImageUrl(month: string, bounds: LatLngBox, width: number): string {
	return wmsImageUrl(ET_WMS, etLayerName(month), bounds, width);
}

/** Inclusive list of YYYY-MM months */
export function monthRange(first: string, last: string): string[] {
	const out: string[] = [];
	let [y, m] = first.split('-').map(Number);
	const [ly, lm] = last.split('-').map(Number);
	while (y < ly || (y === ly && m <= lm)) {
		out.push(`${y}-${String(m).padStart(2, '0')}`);
		if (++m > 12) {
			m = 1;
			y++;
		}
	}
	return out;
}

export function addDays(iso: string, days: number): string {
	const d = new Date(`${iso}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
	return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
