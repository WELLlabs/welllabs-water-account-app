import {
	defaultSeasonKey,
	streamRegion,
	summarizeCells,
	summarySeasonOptions,
	summaryTotals,
	type RegionCell
} from './regionBudget';
import { parseWaterBudgetCsv } from './waterBudget';
import type { WaterSnapshot } from './tlabWater.svelte';

/** A boundary uploaded to the explorer, with its S2 level-13 covering (no Google data yet). */
export interface ExplorerRegion {
	/** Changes with every upload, so the map rebuilds */
	key: string;
	name: string;
	/** Dissolved boundary in WGS84 */
	boundary: GeoJSON.FeatureCollection;
	/** Cell outlines; properties.cellId (decimal) and properties.id (S2 token) like the Raichur grid */
	grid: GeoJSON.FeatureCollection;
	/** [west, south, east, north] */
	bounds: [number, number, number, number];
	areaKm2: number;
	cells: number;
	estimatedSeconds: number;
}

interface CellsResponse {
	boundary: GeoJSON.Polygon | GeoJSON.MultiPolygon;
	bounds: [number, number, number, number];
	areaKm2: number;
	estimatedSeconds: number;
	cells: { id: string; ring: [number, number][] }[];
}

/** S2 cell token: the 64-bit id in hex without trailing zeros */
export function s2Token(id: string): string {
	try {
		return BigInt(id).toString(16).padStart(16, '0').replace(/0+$/, '') || 'X';
	} catch {
		return id;
	}
}

function slug(name: string): string {
	return (
		name
			.replace(/\.[^.]+$/, '')
			.replace(/[^\w]+/g, '_')
			.replace(/^_+|_+$/g, '')
			.toLowerCase() || 'region'
	);
}

export function regionSlug(region: ExplorerRegion): string {
	return slug(region.name);
}

/** Boundary → grid. Runs the S2 covering on the server; no Google calls. */
export async function fetchRegion(name: string, featureCollection: GeoJSON.FeatureCollection): Promise<ExplorerRegion> {
	const res = await fetch('/fwa-api/agri/region/cells', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ geometry: featureCollection })
	});
	const body = await res.json().catch(() => null);
	if (!res.ok) {
		const detail = body?.detail;
		throw new Error(typeof detail === 'string' ? detail : (detail?.message ?? `Could not read the boundary (HTTP ${res.status}).`));
	}
	const r = body as CellsResponse;
	const grid: GeoJSON.FeatureCollection = {
		type: 'FeatureCollection',
		features: r.cells.map((c) => ({
			type: 'Feature',
			geometry: { type: 'Polygon', coordinates: [[...c.ring, c.ring[0]]] },
			properties: { cellId: c.id, id: s2Token(c.id) }
		}))
	};
	return {
		key: `${name}:${Date.now()}`,
		name,
		boundary: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: r.boundary, properties: { name } }] },
		grid,
		bounds: r.bounds,
		areaKm2: r.areaKm2,
		cells: r.cells.length,
		estimatedSeconds: r.estimatedSeconds
	};
}

/** Per-cell water need for every season, from region summary cells (as scripts/tlab_water_totals.mjs). */
export function waterSnapshotFromCells(cells: RegionCell[], budgetCsv: string): WaterSnapshot {
	const budget = parseWaterBudgetCsv(budgetCsv);
	const options = summarySeasonOptions(cells);
	const seasons: WaterSnapshot['seasons'] = [];
	const m3 = new Map<string, number[]>(cells.map((c) => [c.id, []]));
	for (const opt of options) {
		const summary = summarizeCells(cells, { seasonKey: opt.key, minConfidence: 0, sowingDate: '' }, budget);
		const totals = summaryTotals(summary);
		const peak = totals.peak && totals.peak.m3 > 0 ? totals.peak : null;
		seasons.push({
			key: opt.key,
			plots: opt.plots,
			m3: Math.round(totals.m3),
			peak: peak && { calendarMonth: peak.calendarMonth, calendarYear: peak.calendarYear, m3: Math.round(peak.m3) }
		});
		for (const c of summary.cells) m3.get(c.id)!.push(Math.round(c.m3));
	}
	return {
		generatedAt: new Date().toISOString(),
		seasons,
		defaultSeason: defaultSeasonKey(options),
		cells: [...m3].map(([id, values]) => ({ id, m3: values }))
	};
}

const WAPOR_TASKS = [
	{ product: 'aeti', label: 'WaPOR evapotranspiration', temporal: 'month' },
	{ product: 'pcp', label: 'WaPOR precipitation', temporal: 'month' },
	{ product: 'npp', label: 'WaPOR net primary production', temporal: 'month' },
	{ product: 'tbp', label: 'WaPOR biomass', temporal: 'year' },
	{ product: 'gbwp', label: 'WaPOR water productivity', temporal: 'year' }
] as const;

/** Tasks the workspace needs before it opens; WaPOR keeps downloading in the background after that */
const CORE_TASKS = new Set(['google', 'budget']);

/** Seconds until the workspace opens (Google crops + budgets), for the preview screen */
export function estimateLoadSeconds(region: ExplorerRegion): number {
	return Math.round(region.estimatedSeconds + 5);
}

export function formatDuration(sec: number): string {
	if (sec < 90) return `about ${Math.max(5, Math.round(sec / 5) * 5)} seconds`;
	const min = Math.round(sec / 60);
	return `about ${min} minute${min === 1 ? '' : 's'}`;
}

export interface LoadTask {
	key: string;
	label: string;
	done: number;
	total: number;
	unit: string;
	status: 'waiting' | 'loading' | 'done' | 'error';
	error?: string;
}

function periodCount(first: string, latest: string, temporal: 'month' | 'year'): number {
	const [fy, fm] = first.split('-').map(Number);
	const [ly, lm] = latest.split('-').map(Number);
	return temporal === 'year' ? ly - fy + 1 : (ly - fy) * 12 + (lm - fm) + 1;
}

const pause = (ms: number, signal: AbortSignal) =>
	new Promise<void>((resolve, reject) => {
		const t = setTimeout(resolve, ms);
		signal.addEventListener(
			'abort',
			() => {
				clearTimeout(t);
				reject(new DOMException('Aborted', 'AbortError'));
			},
			{ once: true }
		);
	});

/**
 * Everything the explorer shows for a region, fetched before the workspace opens:
 * Google ALU crop totals per cell (water budget + field landscape), the crop water budgets,
 * and the WaPOR rasters for the region's extent (warmed into the server cache).
 */
export class ExplorerLoad {
	status = $state<'idle' | 'loading' | 'done' | 'error'>('idle');
	tasks = $state<LoadTask[]>([]);
	cells = $state.raw<RegionCell[]>([]);
	failedCells = $state(0);
	private controller: AbortController | null = null;

	/** Google crops and budgets: what the workspace waits for */
	coreTasks = $derived(this.tasks.filter((t) => CORE_TASKS.has(t.key)));
	/** WaPOR downloads, which continue after the workspace opens */
	waporTasks = $derived(this.tasks.filter((t) => !CORE_TASKS.has(t.key)));
	core = $derived.by<'idle' | 'loading' | 'done' | 'error'>(() => {
		const c = this.coreTasks;
		if (!c.length) return 'idle';
		if (c.some((t) => t.status === 'loading' || t.status === 'waiting')) return 'loading';
		return c.some((t) => t.status === 'error') ? 'error' : 'done';
	});

	/** 0–1 for the core tasks, Google weighted by its share of the expected time */
	progress = $derived.by(() => {
		if (!this.coreTasks.length) return 0;
		let sum = 0;
		let weight = 0;
		for (const t of this.coreTasks) {
			const w = t.key === 'google' ? 6 : 1;
			const f = t.status === 'done' || t.status === 'error' ? 1 : t.total ? Math.min(1, t.done / t.total) : 0;
			sum += w * f;
			weight += w;
		}
		return weight ? sum / weight : 0;
	});

	private set(key: string, patch: Partial<LoadTask>) {
		this.tasks = this.tasks.map((t) => (t.key === key ? { ...t, ...patch } : t));
	}

	async run(region: ExplorerRegion, extent: string) {
		this.cancel();
		const ctrl = new AbortController();
		this.controller = ctrl;
		this.status = 'loading';
		this.cells = [];
		this.failedCells = 0;
		this.tasks = [
			{ key: 'google', label: 'Google ALU crops (water budget, field landscape)', done: 0, total: region.cells, unit: 'cells', status: 'loading' },
			{ key: 'budget', label: 'Crop water budgets', done: 0, total: 1, unit: '', status: 'loading' },
			...WAPOR_TASKS.map((w) => ({
				key: w.product,
				label: w.label,
				done: 0,
				total: 0,
				unit: w.temporal === 'year' ? 'years' : 'months',
				status: 'loading' as const
			}))
		];
		const [w, s, e, n] = region.bounds;
		const lat = ((s + n) / 2).toFixed(5);
		const lng = ((w + e) / 2).toFixed(5);

		const google = this.google(region, ctrl.signal);
		const budget = fetch('/total_water_needed.csv', { signal: ctrl.signal })
			.then((r) => {
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				this.set('budget', { done: 1, status: 'done' });
			})
			.catch((err) => {
				if (!ctrl.signal.aborted) this.set('budget', { status: 'error', error: String(err?.message ?? err) });
			});
		const wapor = WAPOR_TASKS.map((t) => this.wapor(t.product, t.temporal, lat, lng, extent, ctrl.signal));
		await Promise.allSettled([google, budget, ...wapor]);
		if (this.controller !== ctrl) return;
		this.controller = null;
		this.status = this.tasks.some((t) => t.status === 'error') ? 'error' : 'done';
	}

	cancel() {
		this.controller?.abort();
		this.controller = null;
		if (this.status === 'loading') this.status = 'idle';
	}

	private async google(region: ExplorerRegion, signal: AbortSignal) {
		const working: RegionCell[] = [];
		let failed = 0;
		try {
			await streamRegion(
				'summary',
				region.boundary,
				(msg) => {
					if (msg.type === 'start') return this.set('google', { total: msg.cells });
					if (msg.type !== 'cell') return;
					if (msg.error) failed++;
					else
						working.push({ id: msg.cellId, ring: msg.ring ?? [], plots: msg.plots ?? 0, area: msg.area ?? 0, rows: msg.rows ?? [] });
					if (msg.done % 10 === 0 || msg.done === region.cells) this.set('google', { done: msg.done });
				},
				signal
			);
			this.cells = working;
			this.failedCells = failed;
			const total = working.length + failed;
			if (total && failed === total) throw new Error('Google returned no data for any cell.');
			this.set('google', {
				done: total,
				status: 'done',
				...(failed ? { error: `${failed.toLocaleString('en-IN')} cells failed and stay uncoloured` } : {})
			});
		} catch (err) {
			if (signal.aborted) return;
			this.cells = working;
			this.failedCells = failed;
			this.set('google', { status: 'error', error: err instanceof Error ? err.message : String(err) });
		}
	}

	private async wapor(product: string, temporal: 'month' | 'year', lat: string, lng: string, extent: string, signal: AbortSignal) {
		try {
			const latest = await fetch(`/fwa-api/hydro/wapor/latest?product=${product}`, { signal });
			const range = await latest.json().catch(() => null);
			if (!latest.ok) throw new Error(range?.detail ?? `HTTP ${latest.status}`);
			const total = periodCount(range.first, range.latest, temporal);
			this.set(product, { total });
			const params = new URLSearchParams({ product, lat, lng, start: range.first, end: range.latest, extent });
			for (;;) {
				const res = await fetch(`/fwa-api/hydro/wapor/series?${params}`, { signal, cache: 'no-store' });
				const body = await res.json().catch(() => null);
				if (!res.ok) throw new Error(body?.detail ?? `HTTP ${res.status}`);
				if (body.complete) break;
				this.set(product, { done: Math.min(total - 1, (body.series as unknown[]).length) });
				await pause(1000, signal);
			}
			this.set(product, { done: total, status: 'done' });
		} catch (err) {
			if (signal.aborted) return;
			this.set(product, { status: 'error', error: err instanceof Error ? err.message : String(err) });
		}
	}
}
