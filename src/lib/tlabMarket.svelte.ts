import type { GapiCropHa } from './tlabGapi.svelte';
import { downloadBlob } from './exportUtils';

/** Revenue classes, light to dark gold */
export const REVENUE_PALETTE = ['#fef9c3', '#fde047', '#facc15', '#ca8a04', '#713f12'];
export const REVENUE_EMPTY = '#94a3b8';
const HA_PER_ACRE = 0.40468564224;
/** Yields typed in by the viewer, kept in this browser */
const MANUAL_YIELDS_KEY = 'tlab-manual-yields-v1';

function readManualYields(): Record<string, number> {
	try {
		const raw = JSON.parse(localStorage.getItem(MANUAL_YIELDS_KEY) ?? '{}');
		return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'number' && v > 0)) as Record<string, number>;
	} catch {
		return {};
	}
}

export type MarketLevel = 'district' | 'state' | 'india';

export interface MarketPrice {
	/** ₹ per quintal, median modal price */
	value: number;
	level: MarketLevel;
	place: string;
	reports: number;
	markets: number;
	from: string;
	to: string;
}

export interface MarketYield {
	/** Quintals per hectare of mandi produce */
	value: number;
	level: MarketLevel;
	place: string;
	years: (string | number)[] | null;
	/** [year, area ha, production q] behind the median */
	series?: [string | number, number, number][];
}

export interface MarketCrop {
	commodity: string;
	price: MarketPrice | null;
	yield: MarketYield | null;
}

export interface MarketData {
	asOf: string;
	windowDays: number;
	state: string;
	districts: { district: string; state: string; share: number }[];
	sampleKey: boolean;
	yieldSource: string | null;
	yieldYears: (string | number)[] | null;
	/** How much of the price window the server's copy of mandi reports covers */
	coverage: {
		days: number;
		partialDays: number;
		windowDays: number;
		from: string | null;
		to: string | null;
		collecting: boolean;
		lastError: string | null;
	};
	crops: Record<string, MarketCrop>;
}

export interface CropRevenue {
	crop: string;
	ha: number;
	/** Quintals per hectare used: the viewer's own figure, else DES */
	yieldQha: number | null;
	manualYield: boolean;
	/** ₹ per hectare, or null when the price or yield is missing */
	rate: number | null;
	revenue: number;
	market: MarketCrop | null;
}

export interface PlotRevenue {
	id: string;
	crop: string;
	acres: number;
	revenue: number;
	priced: boolean;
}

/** Five quantile class breaks over positive values */
function breaksOf(values: number[]): number[] {
	const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
	if (!sorted.length) return [];
	return [1, 2, 3, 4].map((q) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * q) / 5))]);
}

export function revenueColor(value: number, breaks: number[]): string {
	if (value <= 0 || !breaks.length) return REVENUE_EMPTY;
	let i = 0;
	while (i < breaks.length && value > breaks[i]) i++;
	return REVENUE_PALETTE[i];
}

/** ₹ in lakh / crore, as people read revenue in India */
export function formatRupees(v: number): string {
	if (v >= 1e7) return `₹${(v / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr`;
	if (v >= 1e5) return `₹${(v / 1e5).toLocaleString('en-IN', { maximumFractionDigits: 2 })} L`;
	return `₹${Math.round(v).toLocaleString('en-IN')}`;
}

export function compactRupees(v: number): string {
	if (v >= 1e7) return `${(v / 1e7).toFixed(1)} Cr`;
	if (v >= 1e5) return `${(v / 1e5).toFixed(1)} L`;
	if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
	return String(Math.round(v));
}

/**
 * Market revenue layer: Google ALU crop hectares × DES yield × Agmarknet mandi price.
 * Prices and yields come from /fwa-api/market/region once per boundary; everything else is
 * computed here from the crop areas the workspace already has.
 */
export class TLabMarket {
	status = $state<'idle' | 'loading' | 'done' | 'error'>('idle');
	error = $state<string | null>(null);
	data = $state.raw<MarketData | null>(null);
	/** Crop hectares per cell for the selected season, set by the workspace */
	cells = $state.raw(new Map<string, GapiCropHa[]>());
	seasonKey = $state('');
	exportName = 'region';
	/** crop → quintals per hectare entered by the viewer; overrides the DES yield */
	manualYields = $state<Record<string, number>>(typeof localStorage === 'undefined' ? {} : readManualYields());
	private controller: AbortController | null = null;
	private loadedFor: GeoJSON.FeatureCollection | null = null;

	yieldOf(crop: string): number | null {
		return this.manualYields[crop] ?? this.data?.crops[crop]?.yield?.value ?? null;
	}

	/** ₹ per hectare for each crop that has both a price and a yield */
	rates = $derived.by(() => {
		const out = new Map<string, number>();
		for (const [crop, m] of Object.entries(this.data?.crops ?? {})) {
			const y = this.yieldOf(crop);
			if (m.price && y) out.set(crop, m.price.value * y);
		}
		return out;
	});

	setYield(crop: string, qha: number | null) {
		const next = { ...this.manualYields };
		if (qha && qha > 0) next[crop] = qha;
		else delete next[crop];
		this.manualYields = next;
		try {
			localStorage.setItem(MANUAL_YIELDS_KEY, JSON.stringify(next));
		} catch {
			// Private mode or blocked storage: the figure still applies until reload
		}
	}

	clearYields() {
		this.manualYields = {};
		try {
			localStorage.removeItem(MANUAL_YIELDS_KEY);
		} catch {
			// ignore
		}
	}

	private cropRevenue(crop: string, ha: number): CropRevenue {
		const rate = this.rates.get(crop) ?? null;
		return {
			crop,
			ha,
			yieldQha: this.yieldOf(crop),
			manualYield: crop in this.manualYields,
			rate,
			revenue: rate ? rate * ha : 0,
			market: this.data?.crops[crop] ?? null
		};
	}

	byCell = $derived.by(() => {
		const out = new Map<string, number>();
		for (const [id, areas] of this.cells) {
			let rs = 0;
			for (const a of areas) rs += (this.rates.get(a.crop) ?? 0) * a.ha;
			out.set(id, rs);
		}
		return out;
	});

	byCrop = $derived.by((): CropRevenue[] => {
		const ha = new Map<string, number>();
		for (const areas of this.cells.values()) for (const a of areas) ha.set(a.crop, (ha.get(a.crop) ?? 0) + a.ha);
		return [...ha]
			.map(([crop, h]) => this.cropRevenue(crop, h))
			.sort((a, b) => b.revenue - a.revenue || b.ha - a.ha);
	});

	totals = $derived.by(() => {
		let revenue = 0;
		let pricedHa = 0;
		let unpricedHa = 0;
		for (const c of this.byCrop) {
			revenue += c.revenue;
			if (c.rate) pricedHa += c.ha;
			else if (c.market) unpricedHa += c.ha;
		}
		const values = [...this.byCell.values()].filter((v) => v > 0);
		return { revenue, pricedHa, unpricedHa, cells: values.length, maxCell: values.length ? Math.max(...values) : 0 };
	});

	breaks = $derived(breaksOf([...this.byCell.values()]));
	fills = $derived(new Map([...this.byCell].map(([id, v]) => [id, revenueColor(v, this.breaks)])));

	cellCrops(id: string): CropRevenue[] {
		return (this.cells.get(id) ?? [])
			.map((a) => this.cropRevenue(a.crop, a.ha))
			.sort((a, b) => b.revenue - a.revenue || b.ha - a.ha);
	}

	/** Revenue of each plot in a clicked cell (plots from the water budget's cell fetch) */
	plotRevenue(plots: { id: string; crop: string; acres: number }[]): PlotRevenue[] {
		return plots
			.map((p) => {
				const rate = this.rates.get(p.crop);
				return { id: p.id, crop: p.crop, acres: p.acres, revenue: rate ? rate * p.acres * HA_PER_ACRE : 0, priced: !!rate };
			})
			.sort((a, b) => b.revenue - a.revenue);
	}

	plotBreaks(plots: PlotRevenue[]): number[] {
		return breaksOf(plots.map((p) => p.revenue));
	}

	/** Plot fills for the cell views: crop colours, revenue classes, or one colour for any revenue */
	plotColors(
		plots: PlotRevenue[],
		mode: 'group' | 'plot' | 'overall' | 'subgroup' = 'plot',
		cropColors: Map<string, string> = new Map()
	): Map<string, string> {
		if (mode === 'group' || mode === 'subgroup') return new Map(plots.map((p) => [p.id, cropColors.get(p.crop) ?? REVENUE_EMPTY]));
		if (mode === 'overall') return new Map(plots.map((p) => [p.id, p.revenue > 0 ? REVENUE_PALETTE[2] : REVENUE_EMPTY]));
		const breaks = this.plotBreaks(plots);
		return new Map(plots.map((p) => [p.id, revenueColor(p.revenue, breaks)]));
	}

	tooltip(id: string): string | null {
		const v = this.byCell.get(id);
		if (v == null) return null;
		const top = this.cellCrops(id).filter((c) => c.revenue > 0).slice(0, 3);
		const rows = top.map((c) => `${c.crop} ${formatRupees(c.revenue)}`).join('<br>');
		return `<strong>${formatRupees(v)}</strong> · ${this.seasonKey}${rows ? `<br>${rows}` : ''}<br><span style="color:#64748b">Click for plot revenue</span>`;
	}

	/** While the server is still copying mandi days, fetch again quietly so prices and the note catch up. */
	private refreshTimer: ReturnType<typeof setTimeout> | null = null;

	private scheduleRefresh(boundary: GeoJSON.FeatureCollection) {
		if (this.refreshTimer) clearTimeout(this.refreshTimer);
		this.refreshTimer = null;
		const c = this.data?.coverage;
		if (!c || c.days >= c.windowDays - 2) return;
		this.refreshTimer = setTimeout(() => {
			this.refreshTimer = null;
			if (this.loadedFor === boundary && this.status === 'done') void this.load(boundary, true);
		}, 60_000);
	}

	async load(boundary: GeoJSON.FeatureCollection, quiet = false) {
		if (!quiet && this.loadedFor === boundary && (this.status === 'loading' || this.status === 'done')) return;
		this.controller?.abort();
		const ctrl = new AbortController();
		this.controller = ctrl;
		this.loadedFor = boundary;
		if (!quiet) {
			this.status = 'loading';
			this.error = null;
		}
		try {
			const res = await fetch('/fwa-api/market/region', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ geometry: boundary }),
				signal: ctrl.signal
			});
			const body = await res.json().catch(() => null);
			if (!res.ok) throw new Error(body?.detail ?? `Could not load mandi prices (HTTP ${res.status}).`);
			this.data = body as MarketData;
			this.status = 'done';
			this.scheduleRefresh(boundary);
		} catch (e) {
			if (ctrl.signal.aborted) return;
			if (quiet) {
				this.scheduleRefresh(boundary);
				return;
			}
			this.error = e instanceof Error ? e.message : String(e);
			this.status = 'error';
			this.loadedFor = null;
		} finally {
			if (this.controller === ctrl) this.controller = null;
		}
	}

	retry(boundary: GeoJSON.FeatureCollection) {
		this.loadedFor = null;
		void this.load(boundary);
	}

	reset() {
		if (this.refreshTimer) clearTimeout(this.refreshTimer);
		this.refreshTimer = null;
		this.controller?.abort();
		this.controller = null;
		this.loadedFor = null;
		this.data = null;
		this.status = 'idle';
		this.error = null;
	}

	downloadCellsCsv() {
		const lines = [
			'cell_id,season,revenue_inr',
			...[...this.byCell].map(([id, v]) => `${id},${this.seasonKey},${Math.round(v)}`)
		];
		const name = `${this.exportName}_revenue_${this.seasonKey.replace(/[^\w]+/g, '_').toLowerCase()}_cells.csv`;
		downloadBlob(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }), name);
	}

	destroy() {
		this.controller?.abort();
	}
}
