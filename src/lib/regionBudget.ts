import { readGpkgFeatureCollection } from './gpkgParser';
import { loadShapefileFromFiles, looksLikeShapefileInput } from './shapefileImport';
import { formatCrop, seasonLabel } from './tlab';
import { downloadBlob, waterExportBaseName } from './exportUtils';
import { GROUP_PALETTE } from './groupUtils';
import type { ProcessedGeoJson } from './gpkgParser';
import {
	calculateWaterSchedule,
	formatCalendarMonth,
	getExportableMonthNeeds,
	roundWaterValue,
	type WaterBudgetRow
} from './waterBudget';

const API = '/fwa-api/agri/region';
const SQ_M_PER_ACRE = 4046.8564224;

/** [start_sec, end_sec, crop_1, conf_1, crop_2, conf_2] */
export type CompactPrediction = [number, number, string | null, number, string | null, number];

export interface RegionField {
	type: 'Feature';
	id: string;
	geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
	properties: { cell: string; area_sq_m: number; pred: CompactPrediction[] };
}

export interface RegionPlan {
	/** Dissolved boundary in WGS84 */
	boundary: GeoJSON.Polygon | GeoJSON.MultiPolygon;
	cells: number;
	/** "plots" streams every plot; "summary" streams per-cell crop totals for large boundaries */
	mode: 'plots' | 'summary';
	maxCells: number;
	maxPlotCells: number;
	areaKm2: number;
	ratePerMinute: number;
	estimatedSeconds: number;
}

/** [season key, sowing month YYYY-MM, crop code, confidence band 0–3, plots, area m²] */
export type SummaryRow = [string, string, string, number, number, number];

export interface RegionCell {
	id: string;
	/** Four [lng, lat] corners */
	ring: [number, number][];
	plots: number;
	area: number;
	rows: SummaryRow[];
}

export type RegionMessage =
	| { type: 'start'; cells: number; areaKm2: number; ratePerMinute: number }
	| {
			type: 'cell';
			cellId: string;
			done: number;
			error?: string;
			features?: RegionField[];
			ring?: [number, number][];
			plots?: number;
			area?: number;
			rows?: SummaryRow[];
	  }
	| { type: 'done'; cells: number; failed: number };

export interface Boundary {
	name: string;
	/** Polygon features in the uploaded file */
	polygons: number;
	featureCollection: GeoJSON.FeatureCollection;
}

function isPolygonal(f: GeoJSON.Feature): boolean {
	const t = f.geometry?.type;
	return t === 'Polygon' || t === 'MultiPolygon';
}

function asFeatureCollection(raw: unknown): GeoJSON.FeatureCollection {
	const obj = raw as { type?: string };
	if (obj?.type === 'FeatureCollection') return raw as GeoJSON.FeatureCollection;
	if (obj?.type === 'Feature') return { type: 'FeatureCollection', features: [raw as GeoJSON.Feature] };
	if (obj?.type === 'Polygon' || obj?.type === 'MultiPolygon') {
		return {
			type: 'FeatureCollection',
			features: [{ type: 'Feature', geometry: raw as GeoJSON.Geometry, properties: {} }]
		};
	}
	throw new Error('The GeoJSON file has no features.');
}

/** Read a boundary from GeoJSON, GeoPackage or shapefile (zip / components). */
export async function readBoundaryFiles(files: File[]): Promise<Boundary> {
	if (files.length === 0) throw new Error('No file selected.');
	const lower = (f: File) => f.name.toLowerCase();
	let name = files.length === 1 ? files[0].name : `${files.length} files`;
	let fc: GeoJSON.FeatureCollection;

	const json = files.find((f) => lower(f).endsWith('.geojson') || lower(f).endsWith('.json'));
	const gpkg = files.find((f) => lower(f).endsWith('.gpkg'));
	if (json) {
		name = json.name;
		try {
			fc = asFeatureCollection(JSON.parse(await json.text()));
		} catch (e) {
			throw new Error(e instanceof SyntaxError ? `${json.name} is not valid JSON.` : (e as Error).message);
		}
	} else if (gpkg) {
		name = gpkg.name;
		fc = (await readGpkgFeatureCollection(await gpkg.arrayBuffer())).featureCollection;
	} else if (looksLikeShapefileInput(files)) {
		const shp = await loadShapefileFromFiles(files);
		name = shp.displayName;
		fc = shp.featureCollection;
	} else {
		throw new Error('Upload a boundary as .geojson, .gpkg, a shapefile .zip, or .shp with its .dbf/.prj.');
	}

	const polygons = fc.features.filter(isPolygonal);
	if (polygons.length === 0) throw new Error('The boundary file has no polygons.');
	// Legacy "crs" member (QGIS exports in UTM etc.); the server reprojects from it
	const crs = (fc as { crs?: unknown }).crs;
	const out = { type: 'FeatureCollection', features: polygons, ...(crs ? { crs } : {}) };
	return { name, polygons: polygons.length, featureCollection: out as GeoJSON.FeatureCollection };
}

async function errorDetail(res: Response): Promise<string> {
	try {
		const body = await res.json();
		const detail = body?.detail;
		if (typeof detail === 'string') return detail;
		if (detail?.message) return String(detail.message);
		return JSON.stringify(detail ?? body);
	} catch {
		return `Request failed (${res.status})`;
	}
}

export async function planRegion(boundary: GeoJSON.FeatureCollection): Promise<RegionPlan> {
	const res = await fetch(`${API}/plan`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ geometry: boundary })
	});
	if (!res.ok) throw new Error(await errorDetail(res));
	return res.json();
}

/** Stream per-cell messages; "fields" sends plots, "summary" sends crop totals. */
export async function streamRegion(
	kind: 'fields' | 'summary',
	boundary: GeoJSON.FeatureCollection,
	onMessage: (msg: RegionMessage) => void,
	signal: AbortSignal,
	cells?: string[]
): Promise<void> {
	const res = await fetch(`${API}/${kind}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ geometry: boundary, ...(cells ? { cells } : {}) }),
		signal,
		cache: 'no-store'
	});
	if (!res.ok || !res.body) throw new Error(await errorDetail(res));

	const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
	let buffer = '';
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += value;
		let nl: number;
		while ((nl = buffer.indexOf('\n')) >= 0) {
			const line = buffer.slice(0, nl).trim();
			buffer = buffer.slice(nl + 1);
			if (line) onMessage(JSON.parse(line) as RegionMessage);
		}
	}
	if (buffer.trim()) onMessage(JSON.parse(buffer) as RegionMessage);
}

/** Plots of a few cells, for drilling into a summary-mode region. */
export async function fetchCellFields(
	boundary: GeoJSON.FeatureCollection,
	cells: string[],
	signal: AbortSignal
): Promise<RegionField[]> {
	const out: RegionField[] = [];
	let error: string | null = null;
	await streamRegion(
		'fields',
		boundary,
		(msg) => {
			if (msg.type !== 'cell') return;
			if (msg.error) error = msg.error;
			else if (msg.features) out.push(...msg.features);
		},
		signal,
		cells
	);
	if (error && !out.length) throw new Error(error);
	return out;
}

export interface SeasonOption {
	key: string;
	season: string;
	label: string;
	startSec: number;
	plots: number;
}

function seasonKeyOf(startSec: number): { key: string; season: string; label: string } {
	const { season, year } = seasonLabel(startSec);
	return { key: `${season} ${year}`, season, label: `${season} ${year}` };
}

/** Seasons present in the crop history, newest first, with how many plots have a prediction. */
export function seasonOptions(fields: RegionField[]): SeasonOption[] {
	const map = new Map<string, SeasonOption>();
	for (const f of fields) {
		const seen = new Set<string>();
		for (const p of f.properties.pred) {
			const s = seasonKeyOf(p[0]);
			let opt = map.get(s.key);
			if (!opt) {
				opt = { ...s, startSec: p[0], plots: 0 };
				map.set(s.key, opt);
			}
			opt.startSec = Math.min(opt.startSec, p[0]);
			if (!seen.has(s.key)) {
				opt.plots++;
				seen.add(s.key);
			}
		}
	}
	return [...map.values()].sort((a, b) => b.startSec - a.startSec);
}

/** Latest Kharif/Rabi season that covers at least half as many plots as the best-covered one. */
export function defaultSeasonKey(options: SeasonOption[]): string {
	const main = options.filter((o) => o.season === 'Kharif' || o.season === 'Rabi');
	const pool = main.length ? main : options;
	const best = Math.max(0, ...pool.map((o) => o.plots));
	return pool.find((o) => o.plots >= best * 0.5)?.key ?? '';
}

function isoDate(sec: number): string {
	const d = new Date(sec * 1000);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface PlotOptions {
	seasonKey: string;
	/** Plots whose top crop confidence is below this are labelled "Uncertain" (no water budget) */
	minConfidence: number;
	/** Fixed sowing date for every plot; empty uses each plot's detection window start */
	sowingDate: string;
}

export const NO_PREDICTION = 'No prediction';
export const UNCERTAIN = 'Uncertain';

/** Plot features with crop / sowingDate / acres columns, ready for enrichFeatureCollection. */
export function buildRegionPlots(fields: RegionField[], opts: PlotOptions): GeoJSON.FeatureCollection {
	const season = seasonOptions(fields).find((o) => o.key === opts.seasonKey);
	const fallbackDate = season ? isoDate(season.startSec) : '';

	const features: GeoJSON.Feature[] = fields.map((f) => {
		let best: CompactPrediction | null = null;
		for (const p of f.properties.pred) {
			if (seasonKeyOf(p[0]).key !== opts.seasonKey) continue;
			if (!best || p[3] > best[3]) best = p;
		}

		const code = best?.[2] ?? null;
		const conf = best?.[3] ?? 0;
		let crop: string;
		if (!code || code === 'NO_PREDICTION') crop = NO_PREDICTION;
		else if (conf < opts.minConfidence) crop = UNCERTAIN;
		else crop = formatCrop(code);

		return {
			type: 'Feature',
			geometry: f.geometry,
			properties: {
				plot_id: f.id,
				crop,
				detected_crop: code ? formatCrop(code) : '',
				confidence: roundWaterValue(conf),
				second_crop: best?.[4] ? formatCrop(best[4]) : '',
				season: opts.seasonKey,
				sowingDate: opts.sowingDate || (best ? isoDate(best[0]) : fallbackDate),
				acres: Math.round((f.properties.area_sq_m / SQ_M_PER_ACRE) * 1000) / 1000,
				s2_cell: f.properties.cell
			}
		};
	});

	return { type: 'FeatureCollection', features };
}

export interface CropSummaryRow {
	crop: string;
	plots: number;
	acres: number;
	matched: boolean;
	totalM3: number;
	m3PerAcre: number;
	/** `${year}-${month}` → m³ */
	months: Map<string, number>;
}

export interface MonthKey {
	key: string;
	calendarMonth: number;
	calendarYear: number;
}

export function summarizeByCrop(geojson: ProcessedGeoJson): { rows: CropSummaryRow[]; months: MonthKey[] } {
	const rows = new Map<string, CropSummaryRow>();
	const months = new Map<string, MonthKey>();

	for (const f of geojson.features) {
		const p = f.properties;
		let row = rows.get(p.crop);
		if (!row) {
			row = { crop: p.crop, plots: 0, acres: 0, matched: false, totalM3: 0, m3PerAcre: 0, months: new Map() };
			rows.set(p.crop, row);
		}
		row.plots++;
		row.acres += p.acres;
		const schedule = p.waterSchedule;
		if (!schedule?.matchedBudget) continue;
		row.matched = true;
		for (const need of getExportableMonthNeeds(schedule)) {
			const key = `${need.calendarYear}-${need.calendarMonth}`;
			months.set(key, { key, calendarMonth: need.calendarMonth, calendarYear: need.calendarYear });
			row.months.set(key, (row.months.get(key) ?? 0) + need.waterM3);
			row.totalM3 += need.waterM3;
		}
	}

	for (const row of rows.values()) row.m3PerAcre = row.acres > 0 ? row.totalM3 / row.acres : 0;

	return {
		rows: [...rows.values()].sort((a, b) => Number(b.matched) - Number(a.matched) || b.totalM3 - a.totalM3 || b.acres - a.acres),
		months: [...months.values()].sort(
			(a, b) => a.calendarYear * 100 + a.calendarMonth - (b.calendarYear * 100 + b.calendarMonth)
		)
	};
}

function csvField(value: string | number): string {
	const s = String(value);
	return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCropSummaryCsv(
	summary: ReturnType<typeof summarizeByCrop>,
	sourceFileName: string | null,
	seasonKey: string
): void {
	const monthCols = summary.months.map((m) => formatCalendarMonth(m.calendarMonth, m.calendarYear));
	const header = ['crop', 'season', 'plots', 'acres', 'water_budget', 'm3_per_acre', 'total_m3', ...monthCols.map((m) => `${m} (m3)`)];
	const lines = summary.rows.map((r) =>
		[
			r.crop,
			seasonKey,
			r.plots,
			roundWaterValue(r.acres),
			r.matched ? 'yes' : 'no',
			roundWaterValue(r.m3PerAcre),
			roundWaterValue(r.totalM3),
			...summary.months.map((m) => roundWaterValue(r.months.get(m.key) ?? 0))
		]
			.map(csvField)
			.join(',')
	);
	const blob = new Blob([[header.map(csvField).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
	downloadBlob(blob, `${waterExportBaseName(sourceFileName)}_crops.csv`);
}

/** Lower edges of the server's confidence bands (see _conf_band in api/agri.py) */
export const CONFIDENCE_BANDS = [0, 0.3, 0.5, 0.7];

function monthStartSec(month: string): number {
	const [y, m] = month.split('-').map(Number);
	return new Date(y, m - 1, 1).getTime() / 1000;
}

export function summarySeasonOptions(cells: RegionCell[]): SeasonOption[] {
	const map = new Map<string, SeasonOption>();
	for (const cell of cells) {
		for (const [key, month, , , plots] of cell.rows) {
			const startSec = monthStartSec(month);
			let opt = map.get(key);
			if (!opt) {
				opt = { key, season: key.split(' ')[0], label: key, startSec, plots: 0 };
				map.set(key, opt);
			}
			opt.startSec = Math.min(opt.startSec, startSec);
			opt.plots += plots;
		}
	}
	return [...map.values()].sort((a, b) => b.startSec - a.startSec);
}

export interface CellTotals {
	id: string;
	ring: [number, number][];
	plots: number;
	acres: number;
	budgetAcres: number;
	m3: number;
	months: Map<string, number>;
}

export interface RegionSummary {
	rows: CropSummaryRow[];
	months: MonthKey[];
	cells: CellTotals[];
}

/** Crop and per-cell water totals from summary rows, mirroring buildRegionPlots + summarizeByCrop. */
export function summarizeCells(
	cells: RegionCell[],
	opts: PlotOptions,
	budget: WaterBudgetRow[]
): RegionSummary {
	const minBand = CONFIDENCE_BANDS.filter((b) => b <= opts.minConfidence + 1e-9).length - 1;
	const schedules = new Map<string, { matched: boolean; needs: Array<MonthKey & { m3PerAcre: number }> }>();
	const rows = new Map<string, CropSummaryRow>();
	const months = new Map<string, MonthKey>();

	function scheduleFor(crop: string, date: string) {
		const cacheKey = `${crop}|${date}`;
		let s = schedules.get(cacheKey);
		if (!s) {
			const schedule = calculateWaterSchedule(crop, date, budget, 1);
			s = {
				matched: schedule.matchedBudget,
				needs: getExportableMonthNeeds(schedule).map((n) => ({
					key: `${n.calendarYear}-${n.calendarMonth}`,
					calendarMonth: n.calendarMonth,
					calendarYear: n.calendarYear,
					m3PerAcre: n.waterM3PerAcre
				}))
			};
			schedules.set(cacheKey, s);
		}
		return s;
	}

	const cellTotals = cells.map((cell) => {
		const tot: CellTotals = { id: cell.id, ring: cell.ring, plots: cell.plots, acres: cell.area / SQ_M_PER_ACRE, budgetAcres: 0, m3: 0, months: new Map() };

		const add = (crop: string, plots: number, acres: number, date: string) => {
			let row = rows.get(crop);
			if (!row) {
				row = { crop, plots: 0, acres: 0, matched: false, totalM3: 0, m3PerAcre: 0, months: new Map() };
				rows.set(crop, row);
			}
			row.plots += plots;
			row.acres += acres;
			const s = scheduleFor(crop, date);
			if (!s.matched) return;
			row.matched = true;
			tot.budgetAcres += acres;
			for (const n of s.needs) {
				const v = n.m3PerAcre * acres;
				months.set(n.key, { key: n.key, calendarMonth: n.calendarMonth, calendarYear: n.calendarYear });
				row.months.set(n.key, (row.months.get(n.key) ?? 0) + v);
				tot.months.set(n.key, (tot.months.get(n.key) ?? 0) + v);
				row.totalM3 += v;
				tot.m3 += v;
			}
		};

		let predictedPlots = 0;
		let predictedArea = 0;
		for (const [key, month, code, band, plots, area] of cell.rows) {
			if (key !== opts.seasonKey) continue;
			predictedPlots += plots;
			predictedArea += area;
			const crop =
				!code || code === 'NO_PREDICTION' ? NO_PREDICTION : band < minBand ? UNCERTAIN : formatCrop(code);
			add(crop, plots, area / SQ_M_PER_ACRE, opts.sowingDate || `${month}-01`);
		}
		if (cell.plots > predictedPlots) {
			add(NO_PREDICTION, cell.plots - predictedPlots, Math.max(0, cell.area - predictedArea) / SQ_M_PER_ACRE, '');
		}
		return tot;
	});

	for (const row of rows.values()) row.m3PerAcre = row.acres > 0 ? row.totalM3 / row.acres : 0;

	return {
		rows: [...rows.values()].sort((a, b) => Number(b.matched) - Number(a.matched) || b.totalM3 - a.totalM3 || b.acres - a.acres),
		months: [...months.values()].sort(
			(a, b) => a.calendarYear * 100 + a.calendarMonth - (b.calendarYear * 100 + b.calendarMonth)
		),
		cells: cellTotals
	};
}

function cellRecord(c: CellTotals, months: MonthKey[], seasonKey: string): Record<string, string | number> {
	const rec: Record<string, string | number> = {
		cell_id: c.id,
		season: seasonKey,
		plots: c.plots,
		farm_acres: roundWaterValue(c.acres),
		budget_acres: roundWaterValue(c.budgetAcres),
		total_m3: roundWaterValue(c.m3),
		m3_per_farm_acre: c.acres > 0 ? roundWaterValue(c.m3 / c.acres) : 0
	};
	for (const m of months) {
		rec[`${formatCalendarMonth(m.calendarMonth, m.calendarYear)} (m3)`] = roundWaterValue(c.months.get(m.key) ?? 0);
	}
	return rec;
}

export function downloadCellsCsv(summary: RegionSummary, sourceFileName: string | null, seasonKey: string): void {
	const records = summary.cells.map((c) => cellRecord(c, summary.months, seasonKey));
	const header = Object.keys(records[0] ?? { cell_id: '' });
	const lines = records.map((r) => header.map((h) => csvField(r[h] ?? '')).join(','));
	const blob = new Blob([[header.map(csvField).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
	downloadBlob(blob, `${waterExportBaseName(sourceFileName)}_cells.csv`);
}

export function downloadCellsGeojson(summary: RegionSummary, sourceFileName: string | null, seasonKey: string): void {
	const fc = {
		type: 'FeatureCollection',
		features: summary.cells.map((c) => ({
			type: 'Feature',
			geometry: { type: 'Polygon', coordinates: [[...c.ring, c.ring[0]]] },
			properties: cellRecord(c, summary.months, seasonKey)
		}))
	};
	const blob = new Blob([JSON.stringify(fc)], { type: 'application/geo+json' });
	downloadBlob(blob, `${waterExportBaseName(sourceFileName)}_cells.geojson`);
}

export interface SummaryTotals {
	m3: number;
	plots: number;
	acres: number;
	matchedPlots: number;
	matchedAcres: number;
	monthTotals: Array<MonthKey & { m3: number }>;
	peak: (MonthKey & { m3: number }) | null;
	unmatched: CropSummaryRow[];
}

export function summaryTotals(summary: { rows: CropSummaryRow[]; months: MonthKey[] }): SummaryTotals {
	const matched = summary.rows.filter((r) => r.matched);
	const monthTotals = summary.months.map((m) => ({
		...m,
		m3: matched.reduce((s, r) => s + (r.months.get(m.key) ?? 0), 0)
	}));
	return {
		m3: matched.reduce((s, r) => s + r.totalM3, 0),
		plots: summary.rows.reduce((s, r) => s + r.plots, 0),
		acres: summary.rows.reduce((s, r) => s + r.acres, 0),
		matchedPlots: matched.reduce((s, r) => s + r.plots, 0),
		matchedAcres: matched.reduce((s, r) => s + r.acres, 0),
		monthTotals,
		peak: monthTotals.reduce<SummaryTotals['peak']>((best, m) => (!best || m.m3 > best.m3 ? m : best), null),
		unmatched: summary.rows.filter((r) => !r.matched)
	};
}

/** Crop → colour, in the same order FarmMap's group view assigns them */
export function cropColorMap(crops: string[]): Map<string, string> {
	const sorted = [...new Set(crops)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
	return new Map(sorted.map((c, i) => [c, GROUP_PALETTE[i % GROUP_PALETTE.length]]));
}
