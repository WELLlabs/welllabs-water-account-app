import { formatCropLabel, seasonLabel, type AgriFeature, type MonitoringPrediction } from './tlab';

/** Crop stage from Google AMED seasons: sowing date plus a harvest date, or the last refresh while the crop is still in the field. */

const DAY = 86_400;
/** A season whose window ends this close to the newest window in the cell is still in the field */
const ONGOING_SLACK_DAYS = 21;
/** Cell-level medians need this many finished seasons of a crop, else the table below is used */
const MIN_SAMPLES = 3;

/** Typical AMED season length in days (sowing to harvest) for Raichur crops */
const TYPICAL_DAYS: Record<string, number> = {
	COTTON: 150,
	RICE: 120,
	SORGHUM: 100,
	CORN: 105,
	CHILLI: 150,
	GROUNDNUT: 105,
	GRAM: 95,
	BAJRA: 85,
	SUGARCANE: 330,
	WHEAT: 110,
	MUSTARD: 105,
	SOYBEANS: 100
};
const DEFAULT_DAYS = 110;

export type StageId = 'establishment' | 'vegetative' | 'flowering' | 'maturity' | 'due' | 'harvested' | 'none';

export const STAGES: { id: StageId; label: string; color: string; note: string }[] = [
	{ id: 'establishment', label: 'Establishment', color: '#bef264', note: 'first 15% of the season' },
	{ id: 'vegetative', label: 'Vegetative', color: '#22c55e', note: '15–45%' },
	{ id: 'flowering', label: 'Flowering', color: '#eab308', note: '45–75%' },
	{ id: 'maturity', label: 'Maturity', color: '#f97316', note: '75–100%' },
	{ id: 'due', label: 'Due for harvest', color: '#b45309', note: 'past the typical length, still in the field' },
	{ id: 'harvested', label: 'Harvested', color: '#78716c', note: 'season window has ended' },
	{ id: 'none', label: 'No crop season', color: '#cbd5e1', note: 'no AMED crop call this season' }
];
export const STAGE_BY_ID = Object.fromEntries(STAGES.map((s) => [s.id, s])) as Record<StageId, (typeof STAGES)[number]>;

export interface StageContext {
	/** Newest window end in the cell, seconds; marks the latest AMED refresh */
	latestEnd: number;
	/** Crop code → median finished-season length in days in this cell */
	days: Map<string, number>;
}

export interface PlotStage {
	stage: StageId;
	crop: string;
	sowingSec: number | null;
	endSec: number | null;
	ongoing: boolean;
	/** Days since sowing (ongoing) or season length (finished) */
	day: number | null;
	typicalDays: number;
}

const sorted = (preds: MonitoringPrediction[] | undefined) =>
	[...(preds ?? [])].sort((a, b) => a.start_timestamp_sec - b.start_timestamp_sec);

const isCrop = (crop: string | undefined) => Boolean(crop) && crop !== 'NO_PREDICTION';

function median(v: number[]): number {
	const s = [...v].sort((a, b) => a - b);
	return s[Math.floor(s.length / 2)];
}

export function stageContext(features: AgriFeature[]): StageContext {
	let latestEnd = 0;
	const lengths = new Map<string, number[]>();
	for (const f of features) {
		if (f.properties?.alu_type !== 'field') continue;
		const preds = sorted(f.properties.monitoring_prediction);
		for (const p of preds) latestEnd = Math.max(latestEnd, p.end_timestamp_sec);
		for (const p of preds.slice(0, -1)) {
			if (!isCrop(p.crop_1)) continue;
			const days = (p.end_timestamp_sec - p.start_timestamp_sec) / DAY;
			if (days < 30) continue;
			const list = lengths.get(p.crop_1!) ?? [];
			list.push(days);
			lengths.set(p.crop_1!, list);
		}
	}
	const days = new Map<string, number>();
	for (const [crop, list] of lengths) if (list.length >= MIN_SAMPLES) days.set(crop, Math.round(median(list)));
	return { latestEnd, days };
}

export function typicalDays(crop: string, ctx: StageContext | null): number {
	return ctx?.days.get(crop) ?? TYPICAL_DAYS[crop] ?? DEFAULT_DAYS;
}

function growthStage(progress: number): StageId {
	if (progress < 0.15) return 'establishment';
	if (progress < 0.45) return 'vegetative';
	if (progress < 0.75) return 'flowering';
	if (progress <= 1) return 'maturity';
	return 'due';
}

/** Stage of one plot in a season key ("Kharif 2026"), as of `nowSec` for crops still in the field. */
export function plotStage(
	preds: MonitoringPrediction[] | undefined,
	seasonKey: string | null,
	ctx: StageContext | null,
	nowSec = Date.now() / 1000
): PlotStage | null {
	const list = sorted(preds);
	if (!seasonKey) return null;
	const pred = list.find((p) => {
		const { season, year } = seasonLabel(p.start_timestamp_sec);
		return `${season} ${year}` === seasonKey;
	});
	const none: PlotStage = {
		stage: 'none',
		crop: 'NO_PREDICTION',
		sowingSec: null,
		endSec: null,
		ongoing: false,
		day: null,
		typicalDays: DEFAULT_DAYS
	};
	if (!pred) return none;
	return predStage(pred, list.at(-1) === pred, ctx, nowSec) ?? none;
}

function predStage(
	pred: MonitoringPrediction,
	latest: boolean,
	ctx: StageContext | null,
	nowSec: number
): PlotStage | null {
	if (!isCrop(pred.crop_1) || pred.end_timestamp_sec <= pred.start_timestamp_sec) return null;
	const crop = pred.crop_1!;
	const typical = typicalDays(crop, ctx);
	const ongoing =
		latest && ctx != null && ctx.latestEnd > 0 && pred.end_timestamp_sec >= ctx.latestEnd - ONGOING_SLACK_DAYS * DAY;
	if (!ongoing) {
		return {
			stage: 'harvested',
			crop,
			sowingSec: pred.start_timestamp_sec,
			endSec: pred.end_timestamp_sec,
			ongoing: false,
			day: Math.round((pred.end_timestamp_sec - pred.start_timestamp_sec) / DAY),
			typicalDays: typical
		};
	}
	const day = Math.max(0, Math.round((nowSec - pred.start_timestamp_sec) / DAY));
	return {
		stage: growthStage(day / typical),
		crop,
		sowingSec: pred.start_timestamp_sec,
		endSec: pred.end_timestamp_sec,
		ongoing: true,
		day,
		typicalDays: typical
	};
}

export interface PlotSeason extends PlotStage {
	key: string;
	/** Harvest date, or sowing + typical length while still in the field */
	harvestSec: number;
}

/** Every AMED crop season of one plot, newest first. */
export function plotSeasons(
	preds: MonitoringPrediction[] | undefined,
	ctx: StageContext | null,
	nowSec = Date.now() / 1000
): PlotSeason[] {
	const list = sorted(preds);
	const out: PlotSeason[] = [];
	for (const p of list) {
		const s = predStage(p, list.at(-1) === p, ctx, nowSec);
		if (!s || s.sowingSec == null || s.endSec == null) continue;
		const { season, year } = seasonLabel(p.start_timestamp_sec);
		out.push({
			...s,
			key: `${season} ${year}`,
			harvestSec: s.ongoing ? s.sowingSec + s.typicalDays * DAY : s.endSec
		});
	}
	return out.reverse();
}

export function stageText(s: PlotStage): string {
	const meta = STAGE_BY_ID[s.stage];
	if (s.stage === 'none') return meta.label;
	if (s.ongoing) return `${meta.label} · day ${s.day} of ~${s.typicalDays}`;
	return `${meta.label} · ${s.day}-day season`;
}

export interface StageRow {
	stage: StageId;
	plots: number;
	ha: number;
}

export interface CropStageRow {
	crop: string;
	label: string;
	plots: number;
	ha: number;
	/** Median sowing date of the crop's plots, seconds */
	sowingSec: number | null;
	/** Stage covering the most area for this crop */
	stage: StageId;
	/** Median days since sowing (ongoing) or season length */
	day: number | null;
	typicalDays: number;
	ongoing: boolean;
	/** 10th–90th percentile sowing dates, seconds */
	sowFrom: number | null;
	sowTo: number | null;
	/** Median harvest date (finished) or latest AMED window end (ongoing), seconds */
	endSec: number | null;
	/** Median sowing + typical length, for crops still in the field */
	expectedEndSec: number | null;
}

function quantile(v: number[], q: number): number {
	const s = [...v].sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * q)))];
}

/** Stage mix by area for the farm plots of one cell and season. */
export function cellStages(features: AgriFeature[], seasonKey: string | null, nowSec = Date.now() / 1000) {
	const ctx = stageContext(features);
	interface CropAcc {
		plots: number;
		ha: number;
		sow: number[];
		end: number[];
		day: number[];
		stageHa: Map<StageId, number>;
		typical: number;
		ongoing: number;
	}
	const byStage = new Map<StageId, StageRow>();
	const byCrop = new Map<string, CropAcc>();
	for (const f of features) {
		if (f.properties?.alu_type !== 'field') continue;
		const s = plotStage(f.properties.monitoring_prediction, seasonKey, ctx, nowSec);
		if (!s) continue;
		const ha = (f.properties.area_sq_m ?? 0) / 10_000;
		const row = byStage.get(s.stage) ?? { stage: s.stage, plots: 0, ha: 0 };
		row.plots++;
		row.ha += ha;
		byStage.set(s.stage, row);
		if (s.stage === 'none') continue;
		const c: CropAcc = byCrop.get(s.crop) ?? {
			plots: 0,
			ha: 0,
			sow: [],
			end: [],
			day: [],
			stageHa: new Map(),
			typical: s.typicalDays,
			ongoing: 0
		};
		c.plots++;
		c.ha += ha;
		if (s.sowingSec != null) c.sow.push(s.sowingSec);
		if (s.endSec != null) c.end.push(s.endSec);
		if (s.day != null) c.day.push(s.day);
		if (s.ongoing) c.ongoing++;
		c.stageHa.set(s.stage, (c.stageHa.get(s.stage) ?? 0) + ha);
		byCrop.set(s.crop, c);
	}
	const stages = STAGES.map((m) => byStage.get(m.id)).filter((r): r is StageRow => Boolean(r));
	const crops: CropStageRow[] = [...byCrop]
		.map(([crop, c]) => {
			const sowingSec = c.sow.length ? median(c.sow) : null;
			const ongoing = c.ongoing * 2 >= c.plots;
			return {
				crop,
				label: formatCropLabel(crop),
				plots: c.plots,
				ha: c.ha,
				sowingSec,
				stage: [...c.stageHa].sort((a, b) => b[1] - a[1])[0][0],
				day: c.day.length ? Math.round(median(c.day)) : null,
				typicalDays: c.typical,
				ongoing,
				sowFrom: c.sow.length ? quantile(c.sow, 0.1) : null,
				sowTo: c.sow.length ? quantile(c.sow, 0.9) : null,
				endSec: c.end.length ? median(c.end) : null,
				expectedEndSec: ongoing && sowingSec != null ? sowingSec + c.typical * DAY : null
			};
		})
		.sort((a, b) => b.ha - a.ha);
	return { ctx, stages, crops, farmHa: stages.reduce((s, r) => s + r.ha, 0) };
}
