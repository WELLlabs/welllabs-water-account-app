import { cropFill } from './cropColors';

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

export const UNCERTAIN_COLOR = '#e2e8f0';

export function cropColor(crop: string): string {
	return cropFill(crop);
}

export function formatCropLabel(crop: string): string {
	if (crop === 'NO_PREDICTION') return 'No prediction';
	return formatCrop(crop);
}

/** Leading ALU label for a season key ("Kharif 2025"); latest season if key is omitted.
 *  Unknown and No prediction are real classes — not fallow. */
export function fieldSeasonCrop(
	preds: MonitoringPrediction[] | undefined,
	seasonKey?: string | null
): string | null {
	const list = [...(preds ?? [])].sort((a, b) => a.start_timestamp_sec - b.start_timestamp_sec);
	if (!list.length) return seasonKey ? 'NO_PREDICTION' : null;
	const pred = seasonKey
		? list.find((p) => {
				const { season, year } = seasonLabel(p.start_timestamp_sec);
				return `${season} ${year}` === seasonKey;
			})
		: list.at(-1);
	if (!pred) return seasonKey ? 'NO_PREDICTION' : null;
	const crop = pred.crop_1;
	if (!crop || crop === 'NO_PREDICTION') return 'NO_PREDICTION';
	return crop;
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
				if (i === 1 && (!crop || crop === 'NO_PREDICTION')) {
					segments.push({ crop: 'NO_PREDICTION', conf: conf && conf > 0 ? conf : 1 });
					break;
				}
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

export type WaporProduct = 'aeti' | 'pcp' | 'npp' | 'tbp' | 'gbwp';
export type EtKind = 'nrsc' | 'wapor' | 'pcp' | 'npp' | 'tbp' | 'gbwp';

export const WAPOR_KIND_PRODUCT: Record<Exclude<EtKind, 'nrsc'>, WaporProduct> = {
	wapor: 'aeti',
	pcp: 'pcp',
	npp: 'npp',
	tbp: 'tbp',
	gbwp: 'gbwp'
};

export function isWaporKind(kind: EtKind | null): kind is Exclude<EtKind, 'nrsc'> {
	return kind != null && kind !== 'nrsc';
}

export const WAPOR_ATTR: Record<Exclude<EtKind, 'nrsc'>, string> = {
	wapor: 'AETI © FAO WaPOR v3 (L1, 300 m)',
	pcp: 'Precipitation © FAO WaPOR v3 (CHIRPS, L1 ~5 km)',
	npp: 'NPP © FAO WaPOR v3 (L1, 300 m)',
	tbp: 'Biomass © FAO WaPOR v3 (L1-TBP-A, 300 m)',
	gbwp: 'Water productivity © FAO WaPOR v3 (L1-GBWP-A, 300 m)'
};

export function waporMapUrl(product: WaporProduct, period: string, bounds: LatLngBox, width: number): string {
	const [[s, w], [n, e]] = bounds;
	const height = Math.max(1, Math.round((width * (n - s)) / (e - w)));
	const params = new URLSearchParams({
		product,
		month: period,
		bbox: [w, s, e, n].map((v) => v.toFixed(5)).join(','),
		width: String(width),
		height: String(height)
	});
	return `/fwa-api/hydro/wapor/map.png?${params}`;
}

/** Same-origin colourised PNG of the Raichur extract (FAO WaPOR v3 L1-AETI-M, 300 m) */
export function waporImageUrl(month: string, bounds: LatLngBox, width: number): string {
	return waporMapUrl('aeti', month, bounds, width);
}

/** WaPOR v3 L1-PCP-M (CHIRPS, ~5 km), monthly rainfall in mm */
export function pcpImageUrl(month: string, bounds: LatLngBox, width: number): string {
	return waporMapUrl('pcp', month, bounds, width);
}

/** Monthly rainfall classes (mm) for WaPOR L1-PCP-M */
export const PCP_BREAKS = [0, 20, 40, 60, 80, 100, 150, 200, 250, 300];
export const PCP_COLORS = [
	'#f7fbff',
	'#deebf7',
	'#c6dbef',
	'#9ecae1',
	'#6baed6',
	'#4292c6',
	'#2171b5',
	'#08519c',
	'#08306b',
	'#041c3a'
];

function classColor(breaks: number[], colors: string[], v: number | null): string {
	if (v == null) return '#cbd5e1';
	let i = 0;
	while (i < breaks.length - 1 && v >= breaks[i + 1]) i++;
	if (v >= breaks[breaks.length - 1]) i = colors.length - 1;
	return colors[i];
}

export function pcpColor(mm: number | null): string {
	return classColor(PCP_BREAKS, PCP_COLORS, mm);
}

/** Monthly net primary production (gC/m²) for WaPOR L1-NPP-M */
export const NPP_BREAKS = [0, 15, 30, 50, 75, 100, 130, 160, 200, 250];
export const NPP_COLORS = [
	'#ffffe5',
	'#f7fcb9',
	'#d9f0a3',
	'#addd8e',
	'#78c679',
	'#41ab5d',
	'#238443',
	'#006837',
	'#004529',
	'#00240f'
];
export function nppColor(v: number | null): string {
	return classColor(NPP_BREAKS, NPP_COLORS, v);
}

/** Annual total biomass production (kg/ha) for WaPOR L1-TBP-A */
export const TBP_BREAKS = [0, 1000, 2500, 5000, 7500, 10000, 15000, 20000, 25000, 35000];
export const TBP_COLORS = [
	'#f7fcfd',
	'#e5f5f9',
	'#ccece6',
	'#99d8c9',
	'#66c2a4',
	'#41ae76',
	'#238b45',
	'#006d2c',
	'#00441b',
	'#002b12'
];
export function tbpColor(v: number | null): string {
	return classColor(TBP_BREAKS, TBP_COLORS, v);
}

/** Annual gross biomass water productivity (kg/m³) for WaPOR L1-GBWP-A */
export const GBWP_BREAKS = [0, 0.3, 0.6, 0.9, 1.2, 1.5, 2.0, 2.5, 3.0, 4.0];
export const GBWP_COLORS = [
	'#a50026',
	'#d73027',
	'#f46d43',
	'#fdae61',
	'#fee08b',
	'#d9ef8b',
	'#a6d96a',
	'#66bd63',
	'#1a9850',
	'#006837'
];
export function gbwpColor(v: number | null): string {
	return classColor(GBWP_BREAKS, GBWP_COLORS, v);
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

/** Inclusive list of calendar years as YYYY */
export function yearRange(first: string, last: string): string[] {
	const a = Number(first.slice(0, 4));
	const b = Number(last.slice(0, 4));
	if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return [];
	return Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
}

export function addDays(iso: string, days: number): string {
	const d = new Date(`${iso}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
	return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
