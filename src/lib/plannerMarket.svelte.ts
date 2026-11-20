import type { MarketData } from '$lib/tlabMarket.svelte';

export interface PlannerDistrict {
	id: string;
	name: string;
	state: string;
}

export interface IncomeOverride {
	/** Mandi / yield crop the planner crop is priced as */
	market?: string;
	/** quintals per acre */
	yieldQac?: number;
	/** ₹ per quintal */
	price?: number;
}

const STORE = 'cropcalc-income-v1';

export const districtLabel = (d: PlannerDistrict) => `${d.name}, ${d.state}`;

/** The crop water calculator's district choice and the mandi prices and yields it loads */
export class PlannerMarket {
	districts = $state<PlannerDistrict[]>([]);
	query = $state('');
	districtId = $state<string | null>(null);
	status = $state<'idle' | 'loading' | 'done' | 'error'>('idle');
	error = $state<string | null>(null);
	data = $state<MarketData | null>(null);
	overrides = $state<Record<string, IncomeOverride>>({});
	private controller: AbortController | null = null;

	district = $derived(this.districts.find((d) => d.id === this.districtId) ?? null);

	async init() {
		let saved: { districtId?: string; overrides?: Record<string, IncomeOverride> } = {};
		try {
			saved = JSON.parse(localStorage.getItem(STORE) ?? '{}');
		} catch {
			/* private window */
		}
		this.overrides = saved.overrides ?? {};
		try {
			const res = await fetch('/fwa-api/boundaries/districts');
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			this.districts = ((await res.json()).items as PlannerDistrict[]).sort((a, b) =>
				districtLabel(a).localeCompare(districtLabel(b))
			);
		} catch (e) {
			this.error = `Could not load the district list (${e instanceof Error ? e.message : e}).`;
			this.status = 'error';
			return;
		}
		const start = this.districts.find((d) => d.id === saved.districtId);
		if (start) void this.pick(start);
	}

	private persist() {
		try {
			localStorage.setItem(STORE, JSON.stringify({ districtId: this.districtId, overrides: this.overrides }));
		} catch {
			/* private window */
		}
	}

	async pick(d: PlannerDistrict) {
		this.districtId = d.id;
		this.query = districtLabel(d);
		this.persist();
		this.controller?.abort();
		const ctrl = new AbortController();
		this.controller = ctrl;
		this.status = 'loading';
		this.error = null;
		try {
			const geo = await fetch(`/fwa-api/boundaries/districts/${encodeURIComponent(d.id)}`, { signal: ctrl.signal });
			if (!geo.ok) throw new Error(`district boundary HTTP ${geo.status}`);
			const res = await fetch('/fwa-api/market/region', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ geometry: await geo.json() }),
				signal: ctrl.signal
			});
			const body = await res.json().catch(() => null);
			if (!res.ok) throw new Error(body?.detail ?? `HTTP ${res.status}`);
			this.data = body as MarketData;
			this.status = 'done';
		} catch (e) {
			if (ctrl.signal.aborted) return;
			this.error = e instanceof Error ? e.message : String(e);
			this.status = 'error';
		}
	}

	/** Typed text in the district box; picks a district once the text matches one exactly */
	setQuery(v: string) {
		this.query = v;
		const hit = this.districts.find((d) => districtLabel(d).toLowerCase() === v.trim().toLowerCase());
		if (hit && hit.id !== this.districtId) void this.pick(hit);
	}

	retry() {
		if (this.district) void this.pick(this.district);
	}

	setOverride(id: string, patch: IncomeOverride) {
		const next = { ...(this.overrides[id] ?? {}), ...patch };
		for (const k of Object.keys(patch) as (keyof IncomeOverride)[]) if (patch[k] === undefined) delete next[k];
		this.overrides = { ...this.overrides, [id]: next };
		this.persist();
	}

	resetOverrides() {
		this.overrides = {};
		this.persist();
	}
}
