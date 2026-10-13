import { enrichFeatureCollection, type ProcessedGeoJson } from './gpkgParser';
import {
	buildRegionPlots,
	cropColorMap,
	fetchCellFields,
	summarizeByCrop,
	summaryTotals,
	type RegionField
} from './regionBudget';
import { getExportableMonthNeeds, type MonthlyWaterNeed } from './waterBudget';
import type { ViewMode } from './groupUtils';
import { downloadBlob } from './exportUtils';

export const WATER_PALETTE = ['#e0f2fe', '#7dd3fc', '#38bdf8', '#0284c7', '#0c4a6e'];
export const WATER_EMPTY = '#94a3b8';
export const WATER_TABLE = 'tlab_water_plots';

/** `v` follows the snapshot format version so a browser never reuses a cached older format */
const WATER_SNAPSHOT_URL = '/fwa-api/tlab/layers/water?v=4';
const SEASON_ORDER = ['Summer', 'Kharif', 'Rabi'];

/** "Kharif 2025" / "Rabi 2025–26" / "Summer 2026" → season, start year and calendar span */
export function seasonParts(key: string): { season: string; year: number; range: string } {
	const [season, label = ''] = key.split(' ');
	const year = Number(label.slice(0, 4));
	const range =
		season === 'Kharif' ? `Jun–Sep ${year}` : season === 'Rabi' ? `Oct ${year} – Jan ${year + 1}` : `Feb–May ${year}`;
	return { season, year, range };
}

/** Five quantile class breaks over positive values, so a few huge values don't wash out the rest */
export function quantileBreaks(values: number[]): number[] {
	const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
	if (!sorted.length) return [];
	return [1, 2, 3, 4].map((q) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * q) / 5))]);
}

export function classColor(value: number, breaks: number[]): string {
	if (value <= 0 || !breaks.length) return WATER_EMPTY;
	let i = 0;
	while (i < breaks.length && value > breaks[i]) i++;
	return WATER_PALETTE[i];
}

export function compactM3(v: number): string {
	return v.toLocaleString('en', { notation: 'compact', maximumFractionDigits: 1 });
}

export interface WaterPlot {
	id: string;
	crop: string;
	acres: number;
	m3: number;
	months: MonthlyWaterNeed[];
	feature: ProcessedGeoJson['features'][number];
}

export interface WaterSeason {
	key: string;
	/** District plots with a crop detected this season */
	plots: number;
	m3: number;
	peak: { calendarMonth: number; calendarYear: number; m3: number } | null;
}

/** scripts/build_tlab_water.py output: water need only, `m3` per cell in `seasons` order */
interface WaterSnapshot {
	generatedAt: string;
	failed?: string[];
	seasons: WaterSeason[];
	defaultSeason: string;
	cells: { id: string; m3: number[] }[];
}

export class TLabWater {
	snapshot = $state.raw<WaterSnapshot | null>(null);
	status = $state<'idle' | 'loading' | 'done' | 'error'>('idle');
	error = $state<string | null>(null);
	budgetCsv = $state<string | null>(null);

	seasonKey = $state('');
	private controller: AbortController | null = null;

	generatedAt = $derived(this.snapshot?.generatedAt ?? null);
	failedCells = $derived(this.snapshot?.failed?.length ?? 0);
	cellIds = $derived(new Set(this.snapshot?.cells.map((c) => c.id) ?? []));
	seasons = $derived(this.snapshot?.seasons ?? []);
	years = $derived([...new Set(this.seasons.map((s) => seasonParts(s.key).year))].sort((a, b) => b - a));
	private seasonIdx = $derived(this.seasons.findIndex((s) => s.key === this.seasonKey));
	totals = $derived(this.seasonIdx >= 0 ? this.seasons[this.seasonIdx] : null);
	/** cellId → m³ for the selected season */
	byCell = $derived(
		new Map(this.seasonIdx >= 0 ? (this.snapshot?.cells ?? []).map((c) => [c.id, c.m3[this.seasonIdx] ?? 0]) : [])
	);
	breaks = $derived(quantileBreaks([...this.byCell.values()]));
	fills = $derived(new Map([...this.byCell].map(([id, m3]) => [id, classColor(m3, this.breaks)])));

	// Plot-level detail for one clicked cell
	cellId = $state<string | null>(null);
	cellFields = $state.raw<RegionField[]>([]);
	cellLoading = $state(false);
	cellError = $state<string | null>(null);
	private cellController: AbortController | null = null;

	viewMode = $state<ViewMode>('group');
	selectedCrop = $state<string | null>(null);
	selectedPlot = $state<string | null>(null);

	processed = $derived.by((): ProcessedGeoJson | null => {
		if (!this.cellFields.length || !this.seasonKey || !this.budgetCsv) return null;
		return enrichFeatureCollection(
			buildRegionPlots(this.cellFields, { seasonKey: this.seasonKey, minConfidence: 0, sowingDate: '' }),
			WATER_TABLE,
			this.budgetCsv,
			{ cropColumn: 'crop', sowingDateColumn: 'sowingDate', fallbackSeason: 'Kharif', acresColumn: 'acres', defaultAcres: 1 }
		);
	});
	cellSummary = $derived(this.processed ? summarizeByCrop(this.processed) : null);
	cellTotals = $derived(this.cellSummary ? summaryTotals(this.cellSummary) : null);
	cropColors = $derived(cropColorMap(this.cellSummary?.rows.map((r) => r.crop) ?? []));
	plots = $derived.by((): WaterPlot[] =>
		(this.processed?.features ?? [])
			.map((f) => {
				const months = f.properties.waterSchedule ? getExportableMonthNeeds(f.properties.waterSchedule) : [];
				return {
					id: String(f.properties.plot_id),
					crop: f.properties.crop,
					acres: f.properties.acres,
					m3: months.reduce((s, m) => s + m.waterM3, 0),
					months,
					feature: f
				};
			})
			.sort((a, b) => b.m3 - a.m3)
	);
	plotBreaks = $derived(quantileBreaks(this.plots.map((p) => p.m3)));

	/** plot_id → fill colour for the current view */
	plotColors = $derived.by(() => {
		const out = new Map<string, string>();
		for (const p of this.plots) {
			if (this.viewMode === 'group') out.set(p.id, this.cropColors.get(p.crop) ?? WATER_EMPTY);
			else if (this.viewMode === 'plot') out.set(p.id, classColor(p.m3, this.plotBreaks));
			else out.set(p.id, p.m3 > 0 ? '#38bdf8' : WATER_EMPTY);
		}
		return out;
	});

	setYear(year: number) {
		const inYear = this.seasons.filter((s) => seasonParts(s.key).year === year);
		if (!inYear.length) return;
		const current = seasonParts(this.seasonKey).season;
		const same = inYear.find((s) => seasonParts(s.key).season === current);
		this.setSeason((same ?? this.seasonsForYear(year)[0]).key);
	}

	seasonsForYear(year: number) {
		return this.seasons
			.filter((s) => seasonParts(s.key).year === year)
			.sort((a, b) => SEASON_ORDER.indexOf(seasonParts(a.key).season) - SEASON_ORDER.indexOf(seasonParts(b.key).season));
	}

	setSeason(key: string) {
		this.seasonKey = key;
		this.selectedPlot = null;
		this.selectedCrop = null;
	}

	downloadCellsCsv() {
		const lines = ['cell_id,season,water_m3', ...[...this.byCell].map(([id, m3]) => `${id},${this.seasonKey},${m3}`)];
		const name = `raichur_water_${this.seasonKey.replace(/[^\w]+/g, '_').toLowerCase()}_cells.csv`;
		downloadBlob(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }), name);
	}

	/** Precomputed water need per cell (scripts/build_tlab_water.py), plus the crop water budgets for cell clicks */
	async load() {
		if (this.status === 'loading' || this.status === 'done') return;
		this.controller = new AbortController();
		const signal = this.controller.signal;
		this.status = 'loading';
		this.error = null;
		try {
			const [snapRes, budgetRes] = await Promise.all([
				fetch(WATER_SNAPSHOT_URL, { signal, cache: 'no-cache' }),
				this.budgetCsv ? null : fetch('/total_water_needed.csv', { signal })
			]);
			if (!snapRes.ok) throw new Error(`Could not load the water budget layer (HTTP ${snapRes.status}).`);
			if (budgetRes && !budgetRes.ok) throw new Error('Could not load the crop water budgets (total_water_needed.csv).');
			const snap = (await snapRes.json()) as WaterSnapshot;
			if (budgetRes) this.budgetCsv = await budgetRes.text();
			this.snapshot = snap;
			if (!this.seasonKey) this.seasonKey = snap.defaultSeason;
			this.status = 'done';
		} catch (e) {
			this.status = 'error';
			if (!signal.aborted) this.error = e instanceof Error ? e.message : 'Loading the water budget failed.';
		} finally {
			this.controller = null;
		}
	}

	async loadCell(cellId: string, boundary: GeoJSON.FeatureCollection) {
		this.cellController?.abort();
		const ctrl = new AbortController();
		this.cellController = ctrl;
		this.cellId = cellId;
		this.cellFields = [];
		this.cellError = null;
		this.selectedPlot = null;
		this.selectedCrop = null;
		this.cellLoading = true;
		try {
			const fields = await fetchCellFields(boundary, [cellId], ctrl.signal);
			if (this.cellController !== ctrl) return;
			this.cellFields = fields;
			if (!fields.length) this.cellError = 'No farm plots in this cell.';
		} catch (e) {
			if (!ctrl.signal.aborted) this.cellError = e instanceof Error ? e.message : 'Could not load plots for this cell.';
		} finally {
			if (this.cellController === ctrl) {
				this.cellLoading = false;
				this.cellController = null;
			}
		}
	}

	clearCell() {
		this.cellController?.abort();
		this.cellController = null;
		this.cellId = null;
		this.cellFields = [];
		this.cellError = null;
		this.cellLoading = false;
		this.selectedPlot = null;
		this.selectedCrop = null;
	}

	destroy() {
		this.controller?.abort();
		this.cellController?.abort();
	}
}
