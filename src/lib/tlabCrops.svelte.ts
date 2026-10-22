import { cropFill } from './cropColors';

/** District/village totals from the Raichur FRUITS scrape (raichur_raw on S3) */
const CROPS_URL = '/fwa-api/tlab/layers/raw-crops';
/** Cadastral parcel outlines, one file per village (KGIS geometry only) */
const PLOTS_URL = (village: string) => `/fwa-api/tlab/layers/plots/${village}.json`;
/** Per-village crop rows from the same Raichur raw scrape */
const RAW_URL = (village: string) => `/fwa-api/tlab/layers/raw-crops/${village}.json`;

type Pairs = [number, number][];

/** Crops by season key, crop indices into VillagePlots.crops */
type BySeason = Record<string, Pairs>;

export interface VillagePlots {
	village: string;
	name: string;
	seasons: string[];
	/** English crop names */
	crops: string[];
	/** By survey number */
	surveys: Record<string, BySeason>;
	/** By hissa ("330/1"), where the survey recorded one */
	hissas: Record<string, BySeason>;
	/** s survey number, l KGIS label, a area ha, c category when not a farm parcel */
	plots: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, { s: number; l: string; a: number; c?: string }>;
}

type RawCrops = Omit<VillagePlots, 'plots'>;

/** GeoJSON ring [lng, lat][] of an S2 cell */
export type CellRing = [number, number][];

export interface PlotInfo {
	id: string;
	village: string;
	villageName: string;
	survey: number;
	label: string;
	areaHa: number;
	category: string | null;
	/** Crops this season and where they came from: the plot's own hissa or its whole survey number */
	areas: CropArea[];
	from: 'hissa' | 'survey' | null;
}

/** Common form of KGIS ("330/1") and crop survey ("330/*\/1") hissa labels */
const plotKey = (label: string) =>
	label
		.toUpperCase()
		.split('/')
		.filter((p) => p.trim() && p.trim() !== '*')
		.join('/');

export interface CropSeason {
	key: string;
	label: string;
	year: number;
	kind: string;
	villages: { total: number; scraped: number; withData: number };
	surveys: { asked: number; answered: number };
	district: Pairs;
	villageCrops: Record<string, Pairs>;
	cellCrops: Record<string, Pairs>;
}

interface CropSnapshot {
	version: number;
	generatedAt: string;
	crops: { kn: string; en: string }[];
	villages: { code: string; name: string }[];
	seasons: CropSeason[];
}

export interface CropGroup {
	id: number;
	name: string;
	/** Kannada names folded into this group */
	kn: string[];
	color: string;
	/** Fallow or non-agricultural: shown, but never a cell's main crop */
	idle: boolean;
}

export interface CropArea {
	group: CropGroup;
	ha: number;
}

const IDLE = new Set(['Fallow', 'Harvested', 'Not recorded', 'Non-agricultural']);
export const CROP_EMPTY = '#e2e8f0';
/** S2 level 13 around Raichur is about 1.25 km² */
const CELL_HA = 125;
const FILL_OPACITY_MIN = 0.16;
const FILL_OPACITY_MAX = 0.92;

/** Prominent-crop fill opacity from how much of the ~125 ha cell that crop occupies. */
export function coverageOpacity(ha: number, cellHa = CELL_HA): number {
	const t = Math.max(0, Math.min(1, ha / cellHa));
	return FILL_OPACITY_MIN + (FILL_OPACITY_MAX - FILL_OPACITY_MIN) * t;
}

function ringContains(ring: CellRing, lng: number, lat: number): boolean {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i];
		const [xj, yj] = ring[j];
		if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + Number.EPSILON) + xi) {
			inside = !inside;
		}
	}
	return inside;
}

function geomContains(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon, lng: number, lat: number): boolean {
	const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
	for (const rings of polys) {
		if (!rings?.length) continue;
		if (!ringContains(rings[0] as CellRing, lng, lat)) continue;
		let hole = false;
		for (let i = 1; i < rings.length; i++) {
			if (ringContains(rings[i] as CellRing, lng, lat)) {
				hole = true;
				break;
			}
		}
		if (!hole) return true;
	}
	return false;
}

function geomBbox(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number, number, number] {
	let s = 90,
		w = 180,
		n = -90,
		e = -180;
	const walk = (coords: unknown) => {
		if (!Array.isArray(coords)) return;
		if (typeof coords[0] === 'number') {
			const [x, y] = coords as [number, number];
			s = Math.min(s, y);
			w = Math.min(w, x);
			n = Math.max(n, y);
			e = Math.max(e, x);
			return;
		}
		for (const c of coords) walk(c);
	};
	walk(geom.coordinates);
	return [s, w, n, e];
}

function geomCentroid(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number] | null {
	const ring =
		geom.type === 'Polygon'
			? geom.coordinates[0]
			: geom.type === 'MultiPolygon'
				? geom.coordinates[0]?.[0]
				: null;
	if (!ring?.length) return null;
	let x = 0;
	let y = 0;
	const n = ring.length - (ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? 1 : 0);
	for (let i = 0; i < n; i++) {
		x += ring[i][0];
		y += ring[i][1];
	}
	return n ? [x / n, y / n] : null;
}

/** Class edges, ha of the focused crop per cell */
export const FOCUS_BREAKS = [5, 20, 50, 100, 200];

function mix(a: string, b: string, t: number): string {
	const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
	const [x, y] = [p(a), p(b)];
	return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

export function focusRamp(color: string): string[] {
	return FOCUS_BREAKS.map((_, i) => mix('#f8fafc', color, 0.18 + (0.82 * i) / (FOCUS_BREAKS.length - 1)));
}

export const fmtHa = (ha: number) =>
	ha >= 100 ? Math.round(ha).toLocaleString('en-IN') : ha >= 10 ? ha.toFixed(0) : ha.toFixed(1);

/** Shortest original FRUITS name (Kannada), if it differs from the English group. */
export function primaryKn(g: { name: string; kn: string[] }): string | null {
	const names = [...new Set(g.kn.map((k) => k.trim()).filter(Boolean))].filter((k) => k !== g.name);
	if (!names.length) return null;
	return names.sort((a, b) => a.length - b.length || a.localeCompare(b, 'kn'))[0];
}

/** "ಹತ್ತಿ · Cotton", or English alone when the survey string was not translated. */
export function cropText(g: { name: string; kn: string[] }): string {
	const kn = primaryKn(g);
	return kn ? `${kn} · ${g.name}` : g.name;
}

export class TLabCrops {
	status = $state<'idle' | 'loading' | 'done' | 'error'>('idle');
	error = $state<string | null>(null);
	private snapshot = $state.raw<CropSnapshot | null>(null);
	/** Selected season key */
	seasonKey = $state<string | null>(null);
	/** Group shown as a per-cell area map; null = main crop per cell */
	focus = $state<number | null>(null);
	/** S2 cellId → village code whose polygon contains the cell centroid */
	private cellVillage = $state.raw<Map<string, string> | null>(null);

	generatedAt = $derived(this.snapshot?.generatedAt ?? null);
	seasons = $derived(
		[...(this.snapshot?.seasons.filter((s) => s.villages.withData > 0) ?? [])].sort(
			(a, b) => a.year - b.year || a.kind.localeCompare(b.kind)
		)
	);
	season = $derived(this.seasons.find((s) => s.key === this.seasonKey) ?? null);
	/** A season still being scraped; a village or two that never answer don't count */
	collecting = $derived(this.season != null && this.season.villages.scraped < this.season.villages.total * 0.99);
	villageNames = $derived(new Map(this.snapshot?.villages.map((v) => [v.code, v.name]) ?? []));
	villageTotal = $derived(this.snapshot?.villages.length ?? 0);

	/** Crop survey names grouped by English name, coloured by district rank across all seasons */
	private grouping = $derived.by(() => {
		const snap = this.snapshot;
		if (!snap) return { groups: [] as CropGroup[], of: [] as number[] };
		const total = new Map<string, number>();
		for (const s of snap.seasons) for (const [i, ha] of s.district) total.set(snap.crops[i].en, (total.get(snap.crops[i].en) ?? 0) + ha);
		const names = [...new Set(snap.crops.map((c) => c.en))].sort((a, b) => (total.get(b) ?? 0) - (total.get(a) ?? 0));
		const groups = names.map((name, id) => ({
			id,
			name,
			kn: snap.crops.filter((c) => c.en === name).map((c) => c.kn),
			color: cropFill(name),
			idle: IDLE.has(name)
		}));
		const byName = new Map(groups.map((g) => [g.name, g.id]));
		return { groups, of: snap.crops.map((c) => byName.get(c.en)!) };
	});
	groups = $derived(this.grouping.groups);

	private fold(pairs: Pairs | undefined): CropArea[] {
		if (!pairs) return [];
		const sums = new Map<number, number>();
		for (const [i, ha] of pairs) {
			const g = this.grouping.of[i];
			sums.set(g, (sums.get(g) ?? 0) + ha);
		}
		return [...sums].map(([g, ha]) => ({ group: this.grouping.groups[g], ha })).sort((a, b) => b.ha - a.ha);
	}

	district = $derived(this.fold(this.season?.district));
	districtTotal = $derived(this.district.reduce((s, c) => s + c.ha, 0));

	private villageCellCount = $derived.by(() => {
		const n = new Map<string, number>();
		if (!this.cellVillage) return n;
		for (const code of this.cellVillage.values()) n.set(code, (n.get(code) ?? 0) + 1);
		return n;
	});

	/** Snapshot cellCrops when present; otherwise village totals split across cells in that village. */
	private cellPairs(season: CropSeason | null, id: string): Pairs | undefined {
		if (!season) return undefined;
		if (Object.keys(season.cellCrops ?? {}).length) return season.cellCrops[id];
		const code = this.cellVillage?.get(id);
		if (!code) return undefined;
		const pairs = season.villageCrops[code];
		if (!pairs) return undefined;
		const n = this.villageCellCount.get(code) || 1;
		return pairs.map(([i, ha]) => [i, ha / n]);
	}

	private cells = $derived.by(() => {
		const out = new Map<string, CropArea[]>();
		const season = this.season;
		if (!season) return out;
		if (Object.keys(season.cellCrops ?? {}).length) {
			for (const [id, pairs] of Object.entries(season.cellCrops)) out.set(id, this.fold(pairs));
			return out;
		}
		if (!this.cellVillage) return out;
		for (const id of this.cellVillage.keys()) {
			const areas = this.fold(this.cellPairs(season, id));
			if (areas.length) out.set(id, areas);
		}
		return out;
	});

	/**
	 * Assign each S2 cell to the village that contains its centroid so village
	 * crop totals can colour the grid when the snapshot has no cellCrops.
	 */
	bindCells(grid: GeoJSON.FeatureCollection | null, villages: GeoJSON.FeatureCollection | null): void {
		if (this.cellVillage || !grid?.features.length || !villages?.features.length) return;
		const STEP = 0.05;
		type Entry = {
			code: string;
			s: number;
			w: number;
			n: number;
			e: number;
			geom: GeoJSON.Polygon | GeoJSON.MultiPolygon;
		};
		const buckets = new Map<string, Entry[]>();
		for (const f of villages.features) {
			const code = String(f.properties?.code ?? '');
			const geom = f.geometry;
			if (!code || (geom?.type !== 'Polygon' && geom?.type !== 'MultiPolygon')) continue;
			const [s, w, n, e] = geomBbox(geom);
			const entry: Entry = { code, s, w, n, e, geom };
			for (let y = Math.floor(s / STEP); y <= Math.floor(n / STEP); y++) {
				for (let x = Math.floor(w / STEP); x <= Math.floor(e / STEP); x++) {
					const k = `${x},${y}`;
					const b = buckets.get(k);
					if (b) b.push(entry);
					else buckets.set(k, [entry]);
				}
			}
		}
		const out = new Map<string, string>();
		for (const f of grid.features) {
			const id = String(f.properties?.cellId ?? '');
			const geom = f.geometry;
			if (!id || (geom?.type !== 'Polygon' && geom?.type !== 'MultiPolygon')) continue;
			const c = geomCentroid(geom);
			if (!c) continue;
			const [lng, lat] = c;
			const cand = buckets.get(`${Math.floor(lng / STEP)},${Math.floor(lat / STEP)}`);
			if (!cand) continue;
			for (const v of cand) {
				if (lat < v.s || lat > v.n || lng < v.w || lng > v.e) continue;
				if (geomContains(v.geom, lng, lat)) {
					out.set(id, v.code);
					break;
				}
			}
		}
		this.cellVillage = out;
	}

	/** Largest crop in the cell, ignoring fallow and non-agricultural land unless that's all there is */
	main(areas: CropArea[]): CropArea | null {
		return areas.find((a) => !a.group.idle) ?? areas[0] ?? null;
	}

	/** Prominent crop per cell, ignoring the “colour by one crop” ramp. */
	mainFills = $derived.by(() => {
		const out = new Map<string, string>();
		for (const [id, areas] of this.cells) {
			const m = this.main(areas);
			if (!m || m.group.idle) continue;
			out.set(id, m.group.color);
		}
		return out;
	});

	fills = $derived.by(() => {
		const out = new Map<string, string>();
		const focus = this.focus != null ? this.groups[this.focus] : null;
		const ramp = focus ? focusRamp(focus.color) : [];
		if (!focus) return this.mainFills;
		for (const [id, areas] of this.cells) {
			const ha = areas.find((a) => a.group.id === focus.id)?.ha ?? 0;
			if (ha < 0.5) continue;
			let k = 0;
			while (k < FOCUS_BREAKS.length - 1 && ha >= FOCUS_BREAKS[k]) k++;
			out.set(id, ramp[k]);
		}
		return out;
	});

	/** Opacity from how much of the cell the prominent crop covers. */
	fillOpacities = $derived.by(() => {
		const out = new Map<string, number>();
		for (const [id, areas] of this.cells) {
			const m = this.main(areas);
			if (!m || m.group.idle) continue;
			out.set(id, coverageOpacity(m.ha));
		}
		return out;
	});

	cell(id: string): CropArea[] {
		return this.cells.get(id) ?? [];
	}

	/** One cell (or the district) across every season */
	history(id: string | null): { season: CropSeason; areas: CropArea[] }[] {
		return this.seasons.map((season) => ({
			season,
			areas: this.fold(id ? this.cellPairs(season, id) : season.district)
		}));
	}

	/** Villages ranked by area of one group this season */
	topVillages(groupId: number, n = 10): { code: string; name: string; ha: number }[] {
		const out: { code: string; name: string; ha: number }[] = [];
		for (const [code, pairs] of Object.entries(this.season?.villageCrops ?? {})) {
			const ha = this.fold(pairs).find((a) => a.group.id === groupId)?.ha ?? 0;
			if (ha > 0) out.push({ code, name: this.villageNames.get(code) ?? code, ha });
		}
		return out.sort((a, b) => b.ha - a.ha).slice(0, n);
	}

	tooltip(id: string): string | null {
		const areas = this.cells.get(id);
		if (!areas?.length || !this.season) return null;
		const m = this.main(areas);
		const cover =
			m && !m.group.idle
				? `<br><span style="color:#64748b">${cropText(m.group)} covers ${Math.min(100, Math.round((m.ha / CELL_HA) * 100))}% of the cell</span>`
				: '';
		const rows = areas
			.slice(0, 4)
			.map((a) => `<span style="color:${a.group.color}">■</span> ${cropText(a.group)} ${fmtHa(a.ha)} ha`)
			.join('<br>');
		return `<strong>${this.season.label}</strong><br>${rows}${cover}<br><span style="color:#64748b">Click for crop history</span>`;
	}

	// ── Parcels, loaded for villages that overlap the clicked grid cell ───

	private plotVillages = $state.raw(new Map<string, VillagePlots>());
	private plotRequests = new Set<string>();
	plotErrors = $state(0);
	/** Seasons with parcel-level crops */
	plotSeasons = $derived(new Set([...this.plotVillages.values()].flatMap((v) => v.seasons)));
	private groupByName = $derived.by(() => {
		const m = new Map(this.groups.map((g) => [g.name, g]));
		for (const g of this.groups) for (const kn of g.kn) m.set(kn, g);
		return m;
	});

	loadPlots(codes: string[]): void {
		for (const code of codes) {
			if (this.plotVillages.has(code) || this.plotRequests.has(code)) continue;
			this.plotRequests.add(code);
			Promise.all([
				fetch(PLOTS_URL(code)).then(async (r) => {
					if (!r.ok) throw new Error(`HTTP ${r.status}`);
					return r.json() as Promise<VillagePlots>;
				}),
				fetch(RAW_URL(code)).then(async (r) => (r.ok ? ((await r.json()) as RawCrops) : null))
			])
				.then(([geom, raw]) => {
					const v = raw
						? { ...geom, seasons: raw.seasons, crops: raw.crops, surveys: raw.surveys, hissas: raw.hissas }
						: { ...geom, seasons: [], crops: [], surveys: {}, hissas: {} };
					this.plotVillages = new Map(this.plotVillages).set(code, v);
				})
				.catch(() => {
					this.plotRequests.delete(code);
					this.plotErrors++;
				});
		}
	}

	plotsLoaded(codes: string[]): boolean {
		return codes.every((c) => this.plotVillages.has(c));
	}

	/** Parcels of the given villages, each with a "pid" of village:index. Optional cell ring keeps only parcels inside the clicked grid. */
	plotCollection(codes: string[], cellRing: CellRing | null = null): GeoJSON.FeatureCollection {
		const features: GeoJSON.Feature[] = [];
		for (const code of codes) {
			const v = this.plotVillages.get(code);
			if (!v) continue;
			v.plots.features.forEach((f, i) => {
				if (cellRing) {
					const c = geomCentroid(f.geometry);
					if (!c || !ringContains(cellRing, c[0], c[1])) return;
				}
				features.push({ ...f, properties: { pid: `${code}:${i}` } });
			});
		}
		return { type: 'FeatureCollection', features };
	}

	private foldNamed(v: VillagePlots, pairs: Pairs | undefined): CropArea[] {
		if (!pairs) return [];
		const sums = new Map<CropGroup, number>();
		for (const [i, ha] of pairs) {
			const name = v.crops[i];
			const g = this.groupByName.get(name) ?? { id: -1, name, kn: [], color: '#94a3b8', idle: false };
			sums.set(g, (sums.get(g) ?? 0) + ha);
		}
		return [...sums].map(([group, ha]) => ({ group, ha })).sort((a, b) => b.ha - a.ha);
	}

	/** Crops of parcels whose centroid falls in the cell, current season. Whole-survey records count once. */
	plotCellAreas(codes: string[], cellRing: CellRing | null, seasonKey = this.seasonKey): CropArea[] {
		if (!cellRing || !seasonKey) return [];
		const sums = new Map<CropGroup, number>();
		const seenSurvey = new Set<string>();
		for (const f of this.plotCollection(codes, cellRing).features) {
			const pid = String(f.properties?.pid ?? '');
			const info = this.plot(pid, seasonKey);
			if (!info?.areas.length) continue;
			if (info.from === 'survey') {
				const k = `${info.village}:${info.survey}`;
				if (seenSurvey.has(k)) continue;
				seenSurvey.add(k);
			}
			for (const a of info.areas) sums.set(a.group, (sums.get(a.group) ?? 0) + a.ha);
		}
		return [...sums].map(([group, ha]) => ({ group, ha })).sort((a, b) => b.ha - a.ha);
	}

	plotCellHistory(codes: string[], cellRing: CellRing | null): { season: CropSeason; areas: CropArea[] }[] {
		return this.seasons.map((season) => ({
			season,
			areas: this.plotCellAreas(codes, cellRing, season.key)
		}));
	}

	/** One parcel across every season that has a picker entry */
	plotHistory(pid: string): { season: CropSeason; info: PlotInfo | null }[] {
		return this.seasons.map((season) => ({ season, info: this.plot(pid, season.key) }));
	}

	plot(pid: string, seasonKey = this.seasonKey): PlotInfo | null {
		const [code, idx] = pid.split(':');
		const v = this.plotVillages.get(code);
		const f = v?.plots.features[Number(idx)];
		if (!v || !f || !seasonKey) return null;
		const p = f.properties;
		const hissa = this.foldNamed(v, v.hissas[plotKey(p.l)]?.[seasonKey]);
		const survey = hissa.length ? [] : this.foldNamed(v, v.surveys[String(p.s)]?.[seasonKey]);
		return {
			id: pid,
			village: code,
			villageName: v.name,
			survey: p.s,
			label: p.l || String(p.s),
			areaHa: p.a,
			category: p.c ?? null,
			areas: hissa.length ? hissa : survey,
			from: hissa.length ? 'hissa' : survey.length ? 'survey' : null
		};
	}

	/** Fill per parcel: main crop, or with a focus crop, darker for a larger share of the parcel */
	plotFills(codes: string[]): Map<string, string> {
		const out = new Map<string, string>();
		const focus = this.focus != null ? this.groups[this.focus] : null;
		const ramp = focus ? focusRamp(focus.color) : [];
		for (const code of codes) {
			const v = this.plotVillages.get(code);
			if (!v) continue;
			for (let i = 0; i < v.plots.features.length; i++) {
				const info = this.plot(`${code}:${i}`);
				if (!info?.areas.length) continue;
				if (focus) {
					const total = info.areas.reduce((s, a) => s + a.ha, 0);
					const share = (info.areas.find((a) => a.group.id === focus.id)?.ha ?? 0) / (total || 1);
					if (share <= 0) continue;
					out.set(info.id, ramp[Math.min(ramp.length - 1, Math.floor(share * ramp.length))]);
				} else {
					const m = this.main(info.areas);
					if (m) out.set(info.id, m.group.color);
				}
			}
		}
		return out;
	}

	plotTooltip(pid: string): string | null {
		const info = this.plot(pid);
		if (!info || !this.season) return null;
		const head = `<strong>${info.villageName} · Sy. ${info.label}</strong> · ${fmtHa(info.areaHa)} ha`;
		if (info.category) return `${head}<br>${info.category}`;
		if (!info.areas.length) return `${head}<br><span style="color:#64748b">No crop survey record, ${this.season.label}</span>`;
		const rows = info.areas
			.slice(0, 4)
			.map((a) => `<span style="color:${a.group.color}">■</span> ${cropText(a.group)} ${a.ha.toFixed(2)} ha`)
			.join('<br>');
		const note = info.from === 'survey' ? '<br><span style="color:#64748b">Whole survey number</span>' : '';
		return `${head}<br>${this.season.label}<br>${rows}${note}`;
	}

	async load(): Promise<void> {
		if (this.status === 'loading' || this.status === 'done') return;
		this.status = 'loading';
		this.error = null;
		try {
			const res = await fetch(CROPS_URL);
			const body = await res.json().catch(() => null);
			if (!res.ok) throw new Error(body?.detail ?? `HTTP ${res.status}`);
			this.snapshot = body as CropSnapshot;
			const counted = this.seasons.filter((s) => s.villages.total > 0);
			const half = counted.filter((s) => s.villages.withData >= s.villages.total / 2);
			this.seasonKey = (half.at(-1) ?? counted.at(-1) ?? this.seasons.at(-1))?.key ?? null;
			this.status = 'done';
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e);
			this.status = 'error';
		}
	}
}
