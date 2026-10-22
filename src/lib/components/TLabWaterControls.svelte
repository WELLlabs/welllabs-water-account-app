<script lang="ts">
	import { formatCalendarMonth } from '$lib/waterBudget';
	import { WATER_EMPTY, WATER_PALETTE, compactM3, seasonParts, type TLabWater } from '$lib/tlabWater.svelte';
	import TLabMapHud, { type HudKeyItem, type HudSeason } from './TLabMapHud.svelte';

	export type WaterCropSource = 'gapi' | 'survey';

	interface Props {
		water: TLabWater;
		source: WaterCropSource;
		onSource: (source: WaterCropSource) => void;
		surveyYears: number[];
		surveyYear: number | null;
		onSurveyYear: (year: number) => void;
		surveySeasons: HudSeason[];
		surveySeasonKey: string | null;
		onSurveySeason: (key: string) => void;
		surveyLegend: HudKeyItem[];
		surveyNote: string;
		surveyReady: boolean;
	}

	let {
		water,
		source,
		onSource,
		surveyYears,
		surveyYear,
		onSurveyYear,
		surveySeasons,
		surveySeasonKey,
		onSurveySeason,
		surveyLegend,
		surveyNote,
		surveyReady
	}: Props = $props();

	const survey = $derived(source === 'survey');
	const year = $derived(survey ? surveyYear : water.seasonKey ? seasonParts(water.seasonKey).year : null);
	const years = $derived(survey ? surveyYears : water.years);
	const seasons = $derived.by((): HudSeason[] => {
		if (survey) return surveySeasons;
		if (year == null) return [];
		return water.seasonsForYear(year).map((s) => {
			const p = seasonParts(s.key);
			const plots =
				s.plots != null
					? ` · ${s.plots.toLocaleString('en', { notation: 'compact', maximumFractionDigits: 1 })} plots`
					: '';
			return { key: s.key, label: `${p.season} · ${p.range}${plots}` };
		});
	});
	const seasonKey = $derived(survey ? surveySeasonKey : water.seasonKey || null);
	const totals = $derived(water.totals);

	function setYear(y: number) {
		if (survey) onSurveyYear(y);
		else water.setYear(y);
	}

	function setSeason(key: string) {
		if (survey) onSurveySeason(key);
		else water.setSeason(key);
	}
</script>

<TLabMapHud
	title="Water budget"
	{years}
	{year}
	onYear={setYear}
	{seasons}
	{seasonKey}
	onSeason={setSeason}
>
	{#snippet extra()}
		<label class="grow">
			<span>Crops on the map</span>
			<select value={source} onchange={(e) => onSource(e.currentTarget.value as WaterCropSource)}>
				<option value="gapi">Google ALU</option>
				<option value="survey">Crop survey</option>
			</select>
		</label>
	{/snippet}

	{#snippet facts()}
		{#if !survey && totals}
			<dl class="facts">
				<div>
					<dt>Water needed</dt>
					<dd>{(totals.m3 / 1e6).toLocaleString('en-IN', { maximumFractionDigits: 1 })} <small>million m³</small></dd>
				</div>
				<div>
					<dt>Plots with a crop</dt>
					<dd>{totals.plots != null ? totals.plots.toLocaleString('en-IN') : '—'}</dd>
				</div>
				<div>
					<dt>Peak month</dt>
					<dd>{totals.peak ? formatCalendarMonth(totals.peak.calendarMonth, totals.peak.calendarYear) : '—'}</dd>
				</div>
			</dl>
		{:else if survey && !surveyReady}
			<p class="note">Loading crop survey…</p>
		{/if}
	{/snippet}

	{#snippet legend()}
		{#if survey}
			{#if surveyLegend.length}
				<ul class="key">
					{#each surveyLegend as item}
						<li>
							<span class="sw" style:background={item.color}></span>
							<span class="lab">{item.label}</span>
							{#if item.count}<span class="n">{item.count}</span>{/if}
						</li>
					{/each}
				</ul>
			{/if}
			{#if surveyNote}<p class="note">{surveyNote}</p>{/if}
		{:else}
			<div class="legend">
				<div class="classes">
					<span style:background={WATER_EMPTY} title="No water need"></span>
					{#each WATER_PALETTE as c}<span style:background={c}></span>{/each}
				</div>
				<div class="ticks">
					{#each [0, ...water.breaks] as b, i}
						<span style:left="{((i + 1) / (WATER_PALETTE.length + 1)) * 100}%">{compactM3(b)}</span>
					{/each}
				</div>
				<p>m³ per cell from Google ALU crops · equal-count classes · grey = no water need</p>
			</div>
		{/if}
	{/snippet}
</TLabMapHud>

<style>
	.facts {
		display: grid;
		grid-template-columns: 1.2fr 1fr 0.9fr;
		gap: 0.4rem;
		margin: 0.55rem 0 0;
	}

	dt {
		font-size: 0.6rem;
		color: #00296b99;
	}

	dd {
		margin: 0.1rem 0 0;
		font-size: 0.8rem;
		font-weight: 700;
		color: #00296b;
	}

	dd small {
		font-size: 0.6rem;
		font-weight: 500;
		color: #00296b99;
	}

	.legend {
		margin-top: 0.55rem;
	}

	.classes {
		display: flex;
		height: 0.55rem;
		border-radius: 999px;
		overflow: hidden;
	}

	.classes span {
		flex: 1;
	}

	.ticks {
		position: relative;
		height: 0.8rem;
		margin-top: 0.15rem;
		font-size: 0.58rem;
		color: #00296b99;
	}

	.ticks span {
		position: absolute;
		translate: -50% 0;
		white-space: nowrap;
	}

	.legend p,
	.note {
		margin: 0.2rem 0 0;
		font-size: 0.6rem;
		color: #00296b99;
	}

	.key {
		list-style: none;
		margin: 0.55rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.18rem;
		max-height: 9.5rem;
		overflow: auto;
	}

	.key li {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		font-size: 0.68rem;
		color: #00296b;
	}

	.sw {
		width: 0.65rem;
		height: 0.65rem;
		border-radius: 0.12rem;
		flex-shrink: 0;
		box-shadow: inset 0 0 0 1px #00296b22;
		translate: 0 0.08rem;
	}

	.lab {
		flex: 1;
		min-width: 0;
		line-height: 1.25;
	}

	.n {
		color: #00296b99;
		font-variant-numeric: tabular-nums;
	}
</style>
