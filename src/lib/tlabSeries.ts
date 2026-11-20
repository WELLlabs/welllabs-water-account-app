/**
 * Year-by-year crop series for the explorer's line charts, shared by the layer panels.
 * Each value is an agricultural year's total over its Kharif, Rabi and Summer seasons.
 */
import { gapiInsight, type GapiCropHa } from './tlabGapi.svelte';
import type { WaterSeason } from './tlabWater.svelte';
import { topCropSeries, type LineSeries } from './components/TLabLineChart.svelte';
import { seasonSlot, sortSeasonColumns } from './components/TLabSeasonChart.svelte';

export type SeasonMix = Map<string, GapiCropHa[]>;
/** agricultural year → its season keys */
export type YearSeasons = Map<string, string[]>;

/** Agricultural year ("2024–25") of a season key; Summer belongs to the year before */
export function agYearOf(key: string): string {
	return seasonSlot(key).group;
}

/** agricultural year → its season keys (Kharif, Rabi, Summer), oldest year first */
export function agYears(keys: string[]): YearSeasons {
	const out: YearSeasons = new Map();
	for (const { key } of sortSeasonColumns(keys.map((key) => ({ key })))) {
		const y = agYearOf(key);
		out.set(y, [...(out.get(y) ?? []), key]);
	}
	return out;
}

/**
 * Agricultural years that have every season the data has (normally Kharif, Rabi and Summer), so a
 * year still in progress, or one the data only partly covers, does not show up as a fall.
 */
export function completeYears(seasonKeys: string[]): YearSeasons {
	const all = agYears(seasonKeys);
	const kinds = new Set(seasonKeys.map((k) => seasonSlot(k).short));
	return new Map([...all].filter(([, ks]) => new Set(ks.map((k) => seasonSlot(k).short)).size >= kinds.size));
}

/** The same season of another year, else that year's first season: for clicking a year on a chart */
export function seasonInYear(years: YearSeasons, year: string, current: string | null): string | null {
	const ks = years.get(year);
	if (!ks?.length) return null;
	const want = current ? seasonSlot(current).short : '';
	return ks.find((k) => seasonSlot(k).short === want) ?? ks[0];
}

export function selectedYear(seasonKey: string | null): string | null {
	return seasonKey ? agYearOf(seasonKey) : null;
}

function sumYear(seasons: string[], by: (key: string) => Map<string, number>): Map<string, number> {
	const out = new Map<string, number>();
	for (const k of seasons) for (const [c, v] of by(k)) out.set(c, (out.get(c) ?? 0) + v);
	return out;
}

/** crop → identified hectares in one season */
export function areaBy(mix: SeasonMix, key: string): Map<string, number> {
	return new Map(gapiInsight(mix.get(key) ?? []).crops.map((a) => [a.crop, a.ha]));
}

/** crop → m³ of crop water need in one season */
export function waterBy(seasons: WaterSeason[], key: string): Map<string, number> {
	return new Map((seasons.find((w) => w.key === key)?.crops ?? []).map((c) => [c.crop, c.m3]));
}

/** crop → ₹ in one season, at today's ₹ per hectare (`rates`) */
export function revenueBy(mix: SeasonMix, rates: Map<string, number>, key: string): Map<string, number> {
	const out = new Map<string, number>();
	for (const a of mix.get(key) ?? []) {
		const r = rates.get(a.crop);
		if (r) out.set(a.crop, (out.get(a.crop) ?? 0) + a.ha * r);
	}
	return out;
}

function yearly(years: YearSeasons, by: (key: string) => Map<string, number>): LineSeries[] {
	const keys = [...years.keys()];
	return topCropSeries(keys, (y) => sumYear(years.get(y) ?? [], by));
}

/** Gross cropped hectares (all seasons added) for the five crops with the most area */
export function grownSeries(mix: SeasonMix, years: YearSeasons): LineSeries[] {
	return yearly(years, (k) => areaBy(mix, k));
}

export function thirstySeries(seasons: WaterSeason[], years: YearSeasons): LineSeries[] {
	return yearly(years, (k) => waterBy(seasons, k));
}

export function revenueSeries(mix: SeasonMix, rates: Map<string, number>, years: YearSeasons): LineSeries[] {
	return yearly(years, (k) => revenueBy(mix, rates, k));
}

export interface ValueRow {
	crop: string;
	perM3: number;
	revenue: number;
	m3: number;
	perHa: number;
}

/** Crops ranked by ₹ earned per m³ of crop water need, over the given years */
export function valueStats(
	mix: SeasonMix,
	rates: Map<string, number>,
	seasons: WaterSeason[],
	years: YearSeasons,
	n = 5
): ValueRow[] {
	const keys = [...years.values()].flat();
	const rev = sumYear(keys, (k) => revenueBy(mix, rates, k));
	const wat = sumYear(keys, (k) => waterBy(seasons, k));
	return [...rev]
		.filter(([c, r]) => r > 0 && (wat.get(c) ?? 0) > 0)
		.map(([crop, revenue]) => ({ crop, revenue, m3: wat.get(crop)!, perM3: revenue / wat.get(crop)!, perHa: rates.get(crop) ?? 0 }))
		.sort((a, b) => b.perM3 - a.perM3)
		.slice(0, n);
}

export function rupeesPerM3(v: number): string {
	return `₹${v >= 100 ? Math.round(v) : v.toFixed(1)}`;
}

function pctChange(from: number, to: number): string {
	const p = Math.round(((to - from) / from) * 100);
	return p === 0 ? 'unchanged' : `${p > 0 ? 'up' : 'down'} ${Math.abs(p)}%`;
}

/**
 * One line on the leading crop and the biggest mover. `noun` finishes "X is the …", e.g.
 * "most grown crop".
 */
export function seriesInsight(
	series: LineSeries[],
	keys: string[],
	format: (v: number) => string,
	noun: string
): string {
	if (!series.length || !keys.length) return '';
	const lastIdx = (s: LineSeries) => {
		for (let i = s.values.length - 1; i >= 0; i--) if (s.values[i] != null) return i;
		return -1;
	};
	// Leader in the latest year that has data, not over the whole period
	const li = Math.max(...series.map(lastIdx));
	if (li < 0) return '';
	const top = series.reduce((a, b) => ((b.values[li] ?? 0) > (a.values[li] ?? 0) ? b : a));
	let out = `${top.key} is the ${noun}: ${format(top.values[li]!)} in ${keys[li]}`;
	const prev = li > 0 ? top.values[li - 1] : null;
	out += prev ? `, ${pctChange(prev, top.values[li]!)} on ${keys[li - 1]}.` : '.';

	// Largest change over the period among the others
	let best: { s: LineSeries; first: number; last: number; fi: number; la: number; rel: number } | null = null;
	for (const s of series.filter((x) => x !== top)) {
		const fi = s.values.findIndex((v) => v != null);
		const la = lastIdx(s);
		if (fi < 0 || la <= fi) continue;
		const first = s.values[fi]!;
		const last = s.values[la]!;
		const rel = Math.abs(last - first) / first;
		if (rel >= 0.25 && (!best || rel > best.rel)) best = { s, first, last, fi, la, rel };
	}
	if (best) {
		out += ` ${best.s.key} ${best.last > best.first ? 'grew' : 'fell'} the most, from ${format(best.first)} in ${keys[best.fi]} to ${format(best.last)} in ${keys[best.la]}.`;
	}
	return out;
}
