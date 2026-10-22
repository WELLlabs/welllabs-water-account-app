import { cropColor, formatCrop } from './tlab';
import { coverageOpacity } from './tlabCrops.svelte';
import { streamRegion, type SummaryRow } from './regionBudget';

const SNAP_URL = '/fwa-api/tlab/gapi-crops';
const IDLE = new Set(['Fallow', 'Harvested', 'No prediction', 'Unknown', 'Uncertain']);

export interface GapiCropHa {
	crop: string;
	ha: number;
}

interface GapiSnapshot {
	version: 1;
	generatedAt: string;
	cells: { id: string; seasons: Record<string, [string, number][]> }[];
}

function foldRows(rows: SummaryRow[]): Map<string, GapiCropHa[]> {
	const bySeason = new Map<string, Map<string, number>>();
	for (const [key, , code, , , area] of rows) {
		if (!code || code === 'NO_PREDICTION' || code === 'UNKNOWN_CROP') continue;
		const crop = formatCrop(code);
		let sums = bySeason.get(key);
		if (!sums) bySeason.set(key, (sums = new Map()));
		sums.set(crop, (sums.get(crop) ?? 0) + area / 10_000);
	}
	const out = new Map<string, GapiCropHa[]>();
	for (const [key, sums] of bySeason) {
		out.set(
			key,
			[...sums]
				.map(([crop, ha]) => ({ crop, ha }))
				.sort((a, b) => b.ha - a.ha)
		);
	}
	return out;
}

function mainOf(areas: GapiCropHa[]): GapiCropHa | null {
	return areas.find((a) => !IDLE.has(a.crop)) ?? areas[0] ?? null;
}

/** District Google ALU crop mix per S2 cell, for Field landscape grid colour. */
export class TLabGapi {
	status = $state<'idle' | 'loading' | 'done' | 'error'>('idle');
	error = $state<string | null>(null);
	done = $state(0);
	total = $state(0);
	seasonKey = $state('');
	private byCell = $state.raw(new Map<string, Map<string, GapiCropHa[]>>());
	private controller: AbortController | null = null;
	private working = new Map<string, Map<string, GapiCropHa[]>>();

	fills = $derived.by(() => {
		const out = new Map<string, string>();
		const season = this.seasonKey;
		if (!season) return out;
		for (const [id, seasons] of this.byCell) {
			const m = mainOf(seasons.get(season) ?? []);
			if (!m) continue;
			out.set(id, cropColor(m.crop));
		}
		return out;
	});

	opacities = $derived.by(() => {
		const out = new Map<string, number>();
		const season = this.seasonKey;
		if (!season) return out;
		for (const [id, seasons] of this.byCell) {
			const m = mainOf(seasons.get(season) ?? []);
			if (!m) continue;
			out.set(id, coverageOpacity(m.ha));
		}
		return out;
	});

	district = $derived.by(() => {
		const sums = new Map<string, number>();
		const season = this.seasonKey;
		if (!season) return [] as GapiCropHa[];
		for (const seasons of this.byCell.values()) {
			for (const a of seasons.get(season) ?? []) sums.set(a.crop, (sums.get(a.crop) ?? 0) + a.ha);
		}
		return [...sums]
			.map(([crop, ha]) => ({ crop, ha }))
			.sort((a, b) => b.ha - a.ha);
	});

	cell(id: string): GapiCropHa[] {
		return this.byCell.get(id)?.get(this.seasonKey) ?? [];
	}

	tooltip(id: string): string | null {
		const areas = this.cell(id);
		if (!areas.length || !this.seasonKey) return null;
		const m = mainOf(areas);
		const cover =
			m && !IDLE.has(m.crop)
				? `<br><span style="color:#64748b">${m.crop} covers ${Math.min(100, Math.round((m.ha / 125) * 100))}% of the cell</span>`
				: '';
		const rows = areas
			.slice(0, 4)
			.map((a) => `<span style="color:${cropColor(a.crop)}">■</span> ${a.crop} ${a.ha >= 10 ? a.ha.toFixed(0) : a.ha.toFixed(1)} ha`)
			.join('<br>');
		return `<strong>${this.seasonKey}</strong> · Google ALU<br>${rows}${cover}<br><span style="color:#64748b">Click for farm plots, wells and ponds</span>`;
	}

	abort() {
		this.controller?.abort();
		this.controller = null;
		if (this.status === 'loading') this.status = this.byCell.size ? 'done' : 'idle';
	}

	async load(boundary: GeoJSON.FeatureCollection): Promise<void> {
		if (this.status === 'loading' || this.status === 'done') return;
		this.status = 'loading';
		this.error = null;
		this.done = 0;
		this.total = 0;
		try {
			const cached = await fetch(SNAP_URL);
			if (cached.ok) {
				const snap = (await cached.json()) as GapiSnapshot;
				this.applySnapshot(snap);
				this.status = 'done';
				return;
			}
			await this.stream(boundary);
			this.status = 'done';
			void this.save();
		} catch (e) {
			if (e instanceof DOMException && e.name === 'AbortError') {
				this.status = this.byCell.size ? 'done' : 'idle';
				return;
			}
			this.error = e instanceof Error ? e.message : String(e);
			this.status = this.byCell.size ? 'done' : 'error';
		} finally {
			this.controller = null;
		}
	}

	private applySnapshot(snap: GapiSnapshot) {
		const next = new Map<string, Map<string, GapiCropHa[]>>();
		for (const c of snap.cells) {
			const seasons = new Map<string, GapiCropHa[]>();
			for (const [key, pairs] of Object.entries(c.seasons)) {
				seasons.set(
					key,
					pairs.map(([crop, ha]) => ({ crop, ha })).sort((a, b) => b.ha - a.ha)
				);
			}
			next.set(c.id, seasons);
		}
		this.working = next;
		this.byCell = next;
		this.total = next.size;
		this.done = next.size;
	}

	private async stream(boundary: GeoJSON.FeatureCollection): Promise<void> {
		this.controller?.abort();
		const ctrl = new AbortController();
		this.controller = ctrl;
		this.working = new Map();
		await streamRegion(
			'summary',
			boundary,
			(msg) => {
				if (msg.type === 'start') {
					this.total = msg.cells;
					return;
				}
				if (msg.type !== 'cell') return;
				this.done = msg.done;
				if (msg.rows && !msg.error) {
					this.working.set(msg.cellId, foldRows(msg.rows));
					if (msg.done === this.total || msg.done % 40 === 0) this.byCell = new Map(this.working);
				}
			},
			ctrl.signal
		);
		this.byCell = new Map(this.working);
	}

	private async save(): Promise<void> {
		const snap: GapiSnapshot = {
			version: 1,
			generatedAt: new Date().toISOString(),
			cells: [...this.byCell].map(([id, seasons]) => ({
				id,
				seasons: Object.fromEntries([...seasons].map(([key, areas]) => [key, areas.map((a) => [a.crop, Math.round(a.ha * 10) / 10] as [string, number])]))
			}))
		};
		try {
			await fetch(SNAP_URL, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(snap)
			});
		} catch {
			/* cache is optional */
		}
	}
}
