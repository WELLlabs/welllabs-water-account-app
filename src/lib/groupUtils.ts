import type { FarmFeatureProperties } from '$lib/gpkgParser';
import {
	getExportableMonthNeeds,
	roundWaterValue,
	type WaterSchedule
} from '$lib/waterBudget';

/** High-visibility palette for satellite basemaps (avoids greens/browns that blend with imagery) */
export const GROUP_PALETTE = [
	'#facc15', // yellow
	'#f472b6', // hot pink
	'#22d3ee', // cyan
	'#a3e635', // lime
	'#fb923c', // orange
	'#e879f9', // fuchsia
	'#f87171', // coral
	'#ffffff', // white
	'#c084fc', // violet
	'#38bdf8', // sky
	'#fde68a', // light amber
	'#fda4af' // rose
];

export type ViewMode = 'plot' | 'group' | 'overall';

export interface AggregatedMonth {
	calendarMonth: number;
	calendarYear: number;
	waterM3: number;
	waterM3PerAcre: number;
}

export interface GroupStats {
	key: string;
	label: string;
	color: string;
	plotCount: number;
	totalAcres: number;
	matchedCount: number;
	totalWaterM3: number;
	totalWaterM3PerAcre: number;
	monthlyNeeds: AggregatedMonth[];
	crops: string[];
}

export interface OverallStats {
	plotCount: number;
	totalAcres: number;
	matchedCount: number;
	totalWaterM3: number;
	totalWaterM3PerAcre: number;
	monthlyNeeds: AggregatedMonth[];
	groupCount: number;
}

const SKIP_GROUP_COLUMNS = new Set([
	'fid',
	'geom',
	'geometry',
	'the_geom',
	'waterschedule',
	'sowingdate'
]);

/** Columns suitable for grouping (categorical / ID-like, not geometry or schedules). */
export function getGroupableColumns(features: GeoJSON.Feature[]): string[] {
	if (features.length === 0) return [];
	const keys = new Set<string>();
	for (const f of features) {
		const props = f.properties ?? {};
		for (const k of Object.keys(props)) {
			if (SKIP_GROUP_COLUMNS.has(k.toLowerCase())) continue;
			const v = props[k];
			if (v !== null && typeof v === 'object') continue;
			keys.add(k);
		}
	}
	// Prefer useful order: crop first, then common names, then alpha
	const preferred = ['crop', 'Village', 'FarmerName', 'IR_Status', 'lateral', 'UniqueId', 'plot_id'];
	const all = Array.from(keys);
	all.sort((a, b) => {
		const ai = preferred.indexOf(a);
		const bi = preferred.indexOf(b);
		if (ai !== -1 || bi !== -1) {
			if (ai === -1) return 1;
			if (bi === -1) return -1;
			return ai - bi;
		}
		return a.localeCompare(b);
	});
	return all;
}

export function getGroupValue(feature: GeoJSON.Feature, column: string): string {
	const raw = feature.properties?.[column];
	if (raw === null || raw === undefined || String(raw).trim() === '') return '(empty)';
	return String(raw);
}

export function styleForGroup(
	fillColor: string,
	opts: { selected?: boolean; muted?: boolean } = {}
): import('leaflet').PathOptions {
	const { selected = false, muted = false } = opts;
	return {
		color: fillColor,
		weight: selected ? 4 : 3,
		fillColor,
		fillOpacity: muted ? 0.1 : selected ? 0.7 : 0.5,
		opacity: muted ? 0.35 : 1
	};
}

function aggregateMonthlyNeeds(features: GeoJSON.Feature[]): AggregatedMonth[] {
	const map = new Map<string, { calendarMonth: number; calendarYear: number; waterM3: number }>();

	for (const f of features) {
		const schedule = (f.properties as FarmFeatureProperties)?.waterSchedule as
			| WaterSchedule
			| undefined;
		if (!schedule?.matchedBudget) continue;
		for (const need of getExportableMonthNeeds(schedule)) {
			const key = `${need.calendarYear}-${need.calendarMonth}`;
			const existing = map.get(key);
			if (existing) {
				existing.waterM3 += need.waterM3;
			} else {
				map.set(key, {
					calendarMonth: need.calendarMonth,
					calendarYear: need.calendarYear,
					waterM3: need.waterM3
				});
			}
		}
	}

	return Array.from(map.values())
		.sort((a, b) => a.calendarYear * 100 + a.calendarMonth - (b.calendarYear * 100 + b.calendarMonth))
		.map((row) => ({
			...row,
			waterM3: roundWaterValue(row.waterM3),
			waterM3PerAcre: 0 // filled by caller once acres known
		}));
}

function sumAcres(features: GeoJSON.Feature[]): number {
	return features.reduce((sum, f) => {
		const acres = Number((f.properties as FarmFeatureProperties)?.acres);
		return sum + (Number.isFinite(acres) ? acres : 0);
	}, 0);
}

function uniqueCrops(features: GeoJSON.Feature[]): string[] {
	const crops = new Set<string>();
	for (const f of features) {
		const crop = (f.properties as FarmFeatureProperties)?.crop;
		if (crop) crops.add(String(crop));
	}
	return Array.from(crops).sort();
}

function finalizeMonthly(monthly: AggregatedMonth[], totalAcres: number): AggregatedMonth[] {
	return monthly.map((m) => ({
		...m,
		waterM3PerAcre: totalAcres > 0 ? roundWaterValue(m.waterM3 / totalAcres) : 0
	}));
}

/** Build per-group stats + colour map for a FeatureCollection. */
export function buildGroupStats(
	features: GeoJSON.Feature[],
	column: string
): { groups: GroupStats[]; colorByKey: Map<string, string> } {
	const buckets = new Map<string, GeoJSON.Feature[]>();
	for (const f of features) {
		const key = getGroupValue(f, column);
		const list = buckets.get(key);
		if (list) list.push(f);
		else buckets.set(key, [f]);
	}

	const keys = Array.from(buckets.keys()).sort((a, b) => {
		if (a === '(empty)') return 1;
		if (b === '(empty)') return -1;
		return a.localeCompare(b, undefined, { numeric: true });
	});

	const colorByKey = new Map<string, string>();
	const groups: GroupStats[] = keys.map((key, i) => {
		const members = buckets.get(key)!;
		const color = GROUP_PALETTE[i % GROUP_PALETTE.length];
		colorByKey.set(key, color);
		const totalAcres = sumAcres(members);
		const monthlyNeeds = finalizeMonthly(aggregateMonthlyNeeds(members), totalAcres);
		const totalWaterM3 = roundWaterValue(monthlyNeeds.reduce((s, m) => s + m.waterM3, 0));
		const matchedCount = members.filter(
			(f) => (f.properties as FarmFeatureProperties)?.waterSchedule?.matchedBudget
		).length;

		return {
			key,
			label: key,
			color,
			plotCount: members.length,
			totalAcres: roundWaterValue(totalAcres),
			matchedCount,
			totalWaterM3,
			totalWaterM3PerAcre: totalAcres > 0 ? roundWaterValue(totalWaterM3 / totalAcres) : 0,
			monthlyNeeds,
			crops: uniqueCrops(members)
		};
	});

	return { groups, colorByKey };
}

export function buildOverallStats(
	features: GeoJSON.Feature[],
	groupCount = 0
): OverallStats {
	const totalAcres = sumAcres(features);
	const monthlyNeeds = finalizeMonthly(aggregateMonthlyNeeds(features), totalAcres);
	const totalWaterM3 = roundWaterValue(monthlyNeeds.reduce((s, m) => s + m.waterM3, 0));
	const matchedCount = features.filter(
		(f) => (f.properties as FarmFeatureProperties)?.waterSchedule?.matchedBudget
	).length;

	return {
		plotCount: features.length,
		totalAcres: roundWaterValue(totalAcres),
		matchedCount,
		totalWaterM3,
		totalWaterM3PerAcre: totalAcres > 0 ? roundWaterValue(totalWaterM3 / totalAcres) : 0,
		monthlyNeeds,
		groupCount
	};
}
