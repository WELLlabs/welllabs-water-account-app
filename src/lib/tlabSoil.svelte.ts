import { byteLut } from './tlab';

/** Sentinel-1 surface soil moisture built by scripts/build_tlab_sm.py */
const SM_SNAPSHOT_URL = '/fwa-api/tlab/layers/sm';
const smFrameUrl = (date: string, version: string) =>
	`/fwa-api/tlab/layers/sm/${date}.png?v=${encodeURIComponent(version)}`;

/** Relative surface wetness class edges in %, driest to wettest */
export const SM_BREAKS = [10, 20, 30, 40, 50, 60, 70];
export const SM_PALETTE = ['#8c510a', '#bf812d', '#dfc27d', '#f6e8c3', '#c7eae5', '#80cdc1', '#35978f', '#01665e'];
export const SM_EMPTY = '#cbd5e1';

export function smColor(v: number | null | undefined): string {
	if (v == null) return SM_EMPTY;
	let i = 0;
	while (i < SM_BREAKS.length && v >= SM_BREAKS[i]) i++;
	return SM_PALETTE[i];
}

/** Frame bytes: 0 no data, 1..101 = 0..100 % */
export const SM_LUT = byteLut((b) => (b === 0 ? null : smColor(b - 1)));
export const smFromByte = (b: number): number | null => (b === 0 ? null : b - 1);

export interface SmPass {
	date: string;
	tracks: number[];
	/** Share of the district this pass saw */
	cover: number;
	/** District mean of the frame, % */
	mean: number | null;
}

interface SmSnapshot {
	version: number;
	generatedAt: string;
	method: { resolutionM: number; dryPercentile: number; wetPercentile: number; minRangeDb: number; maxAgeDays: number };
	image: { bounds: [[number, number], [number, number]]; width: number; height: number };
	dates: SmPass[];
	cells: { ids: string[]; noValue: number; values: string[] };
}

export interface SmObservation {
	date: string;
	value: number;
}

const DAY_MS = 86_400_000;
const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);

function decodeRow(b64: string): Uint8Array {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

export class TLabSoil {
	status = $state<'idle' | 'loading' | 'done' | 'error'>('idle');
	error = $state<string | null>(null);
	private snapshot = $state.raw<SmSnapshot | null>(null);
	/** Selected pass */
	idx = $state(-1);

	private rowOf = new Map<string, number>();
	private decoded = new Map<number, Uint8Array>();
	private passDays: number[] = [];

	passes = $derived(this.snapshot?.dates ?? []);
	pass = $derived(this.passes[this.idx] ?? null);
	date = $derived(this.pass?.date ?? null);
	latest = $derived(this.passes.at(-1)?.date ?? null);
	first = $derived(this.passes[0]?.date ?? null);
	maxAgeDays = $derived(this.snapshot?.method.maxAgeDays ?? 12);
	resolutionM = $derived(this.snapshot?.method.resolutionM ?? 250);
	frame = $derived(
		this.snapshot && this.date
			? { url: smFrameUrl(this.date, this.snapshot.generatedAt), bounds: this.snapshot.image.bounds }
			: null
	);

	async load() {
		if (this.status === 'loading' || this.status === 'done') return;
		this.status = 'loading';
		this.error = null;
		try {
			const res = await fetch(SM_SNAPSHOT_URL);
			const body = await res.json().catch(() => null);
			if (!res.ok || !body?.dates) throw new Error(body?.detail ?? `Soil moisture layer returned HTTP ${res.status}.`);
			const snap = body as SmSnapshot;
			this.rowOf = new Map(snap.cells.ids.map((id, i) => [id, i]));
			this.decoded.clear();
			this.passDays = snap.dates.map((d) => dayNumber(d.date));
			this.snapshot = snap;
			this.idx = snap.dates.length - 1;
			this.status = 'done';
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e);
			this.status = 'error';
		}
	}

	/** Select the last pass on or before `iso` (the first pass if `iso` is earlier) */
	setDate(iso: string) {
		const day = dayNumber(iso);
		let i = this.passDays.length - 1;
		while (i > 0 && this.passDays[i] > day) i--;
		this.idx = Math.max(0, i);
	}

	private row(id: string): Uint8Array | null {
		const r = this.rowOf.get(id);
		if (r == null || !this.snapshot) return null;
		let row = this.decoded.get(r);
		if (!row) {
			row = decodeRow(this.snapshot.cells.values[r]);
			this.decoded.set(r, row);
		}
		return row;
	}

	/** The cell's latest value up to the selected pass, as long as it is no older than the map frame allows */
	cellValue(id: string, idx = this.idx): SmObservation | null {
		const row = this.row(id);
		const none = this.snapshot?.cells.noValue ?? 255;
		if (!row || idx < 0) return null;
		const limit = this.passDays[idx] - this.maxAgeDays;
		for (let i = idx; i >= 0 && this.passDays[i] >= limit; i--) {
			if (row[i] !== none) return { date: this.passes[i].date, value: row[i] };
		}
		return null;
	}

	/** Every pass that saw the cell */
	series(id: string): SmObservation[] {
		const row = this.row(id);
		const none = this.snapshot?.cells.noValue ?? 255;
		if (!row) return [];
		const out: SmObservation[] = [];
		row.forEach((v, i) => {
			if (v !== none) out.push({ date: this.passes[i].date, value: v });
		});
		return out;
	}
}
