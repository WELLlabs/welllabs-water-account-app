<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cropColor } from '$lib/tlab';
	import { fmtHa } from '$lib/tlabCrops.svelte';
	import { gapiInsight, pinGapiLegend, type TLabGapi } from '$lib/tlabGapi.svelte';
	import { seasonParts } from '$lib/tlabWater.svelte';
	import TLabLineChart from './TLabLineChart.svelte';
	import { completeYears, grownSeries, seasonInYear, selectedYear, seriesInsight } from '$lib/tlabSeries';
	import TLabSeasonChart, { seasonSlot, sortSeasonColumns, type SeasonColumn } from './TLabSeasonChart.svelte';

	interface Props {
		/** Heading for the area the insights cover */
		regionName?: string;
		gapi: TLabGapi;
		seasons: string[];
		onSeason: (key: string) => void;
		/** Selected-cell detail shown above the district insights */
		children?: Snippet;
		/** Wider panel for the selected-cell crop calendar */
		wide?: boolean;
	}

	let { gapi, seasons, onSeason, children, wide = false, regionName = 'Raichur district' }: Props = $props();

	const TOP = 6;
	const insight = $derived(gapi.insight);
	const season = $derived(gapi.seasonKey ? seasonParts(gapi.seasonKey) : null);
	const listed = $derived(pinGapiLegend(gapi.district, 12));
	const maxHa = $derived(Math.max(1, ...listed.map((a) => a.ha)));

	const keyCrops = $derived.by(() => {
		const sums = new Map<string, number>();
		for (const areas of gapi.allMix.values()) {
			for (const a of gapiInsight(areas).crops) sums.set(a.crop, (sums.get(a.crop) ?? 0) + a.ha);
		}
		return [...sums].sort((a, b) => b[1] - a[1]).slice(0, TOP).map(([crop]) => crop);
	});

	const bars = $derived(
		(seasons.length ? seasons : gapi.seasonKeys)
			.map((key) => {
				const info = gapiInsight(gapi.allMix.get(key) ?? []);
				const parts = keyCrops.map((crop) => ({
					crop,
					ha: info.crops.find((a) => a.crop === crop)?.ha ?? 0
				}));
				const named = parts.reduce((s, p) => s + p.ha, 0);
				const other = Math.max(0, info.identified - named);
				return { key, info, parts, other };
			})
			.filter((b) => b.info.farm > 0.5)
	);
	const maxSum = $derived(Math.max(1, ...bars.map((b) => b.info.farm)));

	const columns = $derived<SeasonColumn[]>(
		sortSeasonColumns(bars).map((b) => {
			const slot = seasonSlot(b.key);
			return {
				key: b.key,
				short: slot.short,
				group: slot.group,
				// Height is the area ALU made a crop call on, so seasons with little cropping come out short
				total: b.info.identified + b.info.unknown,
				segments: [
					...b.parts.map((p) => ({ color: cropColor(p.crop), value: p.ha })),
					{ color: '#475569', value: b.other },
					{ color: cropColor('Unknown'), value: b.info.unknown }
				],
				title: `${b.key}: ${fmtHa(b.info.identified)} ha identified crop, ${fmtHa(b.info.unknown)} ha unknown, ${fmtHa(b.info.none)} ha no prediction (of ${fmtHa(b.info.farm)} ha farm)`
			};
		})
	);

	const grownYears = $derived(completeYears(bars.map((b) => b.key)));
	const grownKeys = $derived([...grownYears.keys()]);
	const grown = $derived(grownSeries(gapi.allMix, grownYears));

	function pct(part: number, whole: number): string {
		if (whole <= 0 || part <= 0) return '0%';
		return `${((part / whole) * 100).toFixed(1)}%`;
	}
</script>

<aside class="panel" class:wide aria-label="Google ALU district insights">
	<header>
		<div class="title">
			<span class="sw" style:background="linear-gradient(135deg, #db2777, #2563eb, #7dd3fc)"></span>
			<div>
				<h2>Google ALU AMED</h2>
				<p class="meta">
					{regionName}{#if season}
						· {season.season} {season.year}
						<small>{season.range}</small>
					{/if}
				</p>
			</div>
		</div>
	</header>

	{@render children?.()}

	{#if gapi.status === 'error'}
		<section>
			<p class="muted">Google ALU crops unavailable: {gapi.error}</p>
		</section>
	{:else if gapi.status === 'idle' || (gapi.status === 'loading' && !gapi.district.length)}
		<section>
			<p class="muted">
				{#if gapi.status === 'loading' && gapi.total}
					Loading district crop mix… {gapi.done.toLocaleString('en-IN')} of {gapi.total.toLocaleString('en-IN')} cells.
				{:else}
					Loading district crop mix…
				{/if}
			</p>
		</section>
	{:else}
		<section>
			<dl class="facts">
				<div>
					<dt>Identified crop</dt>
					<dd>
						{fmtHa(insight.identified)} <small class="inline">ha</small>
						<small>{pct(insight.identified, insight.farm)} of farm plots</small>
					</dd>
				</div>
				<div>
					<dt>Unknown</dt>
					<dd>
						{fmtHa(insight.unknown)} <small class="inline">ha</small>
						<small>ALU could not name the crop</small>
					</dd>
				</div>
				<div>
					<dt>No prediction</dt>
					<dd>
						{fmtHa(insight.none)} <small class="inline">ha</small>
						<small>No crop call this season</small>
					</dd>
				</div>
				<div>
					<dt>Farm plots</dt>
					<dd>
						{fmtHa(insight.farm)} <small class="inline">ha</small>
						<small>{gapi.cellCount.toLocaleString('en-IN')} cells</small>
					</dd>
				</div>
			</dl>
			{#if gapi.status === 'loading' && gapi.total}
				<p class="muted note">
					Still loading {gapi.done.toLocaleString('en-IN')} of {gapi.total.toLocaleString('en-IN')} cells.
				</p>
			{/if}
		</section>

		<section>
			<h3>{gapi.seasonKey || 'This season'} by crop</h3>
			{#if !listed.length}
				<p class="muted">No Google ALU crop mix for this season yet.</p>
			{:else}
				<table>
					<thead><tr><th>Class</th><th class="num">ha</th><th class="num">Share</th><th></th></tr></thead>
					<tbody>
						{#each listed as a (a.crop)}
							<tr>
								<td><span class="chip" style:background={cropColor(a.crop)}></span>{a.crop}</td>
								<td class="num">{fmtHa(a.ha)}</td>
								<td class="num">{pct(a.ha, insight.farm)}</td>
								<td class="barcell"><span style:width="{(a.ha / maxHa) * 100}%" style:background={cropColor(a.crop)}></span></td>
							</tr>
						{/each}
					</tbody>
				</table>
				{#if listed.length < gapi.district.length}
					<p class="muted note">{gapi.district.length - listed.length} smaller classes not listed.</p>
				{/if}
			{/if}
		</section>

		{#if bars.length}
			<section>
				<h3>Every season</h3>
				<p class="muted">Cropped area each season, by crop. No prediction is left out, so taller columns mean more land under a crop. K Kharif, R Rabi, S Summer. Click a column to show that season on the map.</p>
				<TLabSeasonChart
					columns={columns}
					selected={gapi.seasonKey}
					onSelect={onSeason}
					format={fmtHa}
					unit="ha"
					legend={[
						...keyCrops.map((crop) => ({ color: cropColor(crop), label: crop })),
						{ color: '#475569', label: 'Other' },
						{ color: cropColor('Unknown'), label: 'Unknown' }
					]}
					label="Farm area by season"
				/>
			</section>
			<section>
				<h3>Most grown crops</h3>
				<TLabLineChart
					keys={grownKeys}
					series={grown}
					selected={selectedYear(gapi.seasonKey)}
					onSelect={(y) => {
						const k = seasonInYear(grownYears, y, gapi.seasonKey);
						if (k) onSeason(k);
					}}
					format={(v) => `${fmtHa(v)} ha`}
					insight={seriesInsight(grown, grownKeys, (v) => `${fmtHa(v)} ha`, 'most grown crop')}
					label="Gross cropped area of the five most grown crops by agricultural year"
				/>
				<p class="muted">Gross cropped area per agricultural year: Kharif, Rabi and Summer added up. Complete years only.</p>
			</section>
		{/if}

		<section>
			<p class="muted">
				Unknown — ALU ran a crop call but could not name the crop. No prediction — no crop call this season
				(not fallow). Year and season are on the map.
			</p>
		</section>
	{/if}
</aside>

<style>
	.panel {
		width: 23rem;
		flex-shrink: 0;
		transition: width 0.15s ease;
		overflow-y: auto;
		background: white;
		border-left: 1px solid color-mix(in srgb, #00296b 12%, white);
		font-family: 'Montserrat', sans-serif;
		color: #00296b;
	}

	header {
		position: sticky;
		top: 0;
		z-index: 1;
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 1rem 1rem 0.75rem;
		background: white;
		border-bottom: 1px solid #00296b12;
	}

	.title {
		display: flex;
		gap: 0.6rem;
		align-items: flex-start;
	}

	h2 {
		margin: 0;
		font-family: 'Josefin Sans', sans-serif;
		font-size: 1.2rem;
		font-weight: 700;
	}

	h3 {
		margin: 0 0 0.5rem;
		font-size: 0.85rem;
		font-weight: 700;
	}

	.meta {
		margin: 0.15rem 0 0;
		font-size: 0.75rem;
		color: #00296bcc;
	}

	.meta small {
		display: block;
		color: #00296b99;
	}

	section {
		padding: 0.9rem 1rem;
		border-bottom: 1px solid #00296b0d;
	}

	.sw {
		display: inline-block;
		width: 0.9rem;
		height: 0.9rem;
		border-radius: 0.2rem;
		margin-top: 0.25rem;
		flex-shrink: 0;
	}

	.chip {
		display: inline-block;
		width: 0.65rem;
		height: 0.65rem;
		margin-right: 0.35rem;
		border-radius: 0.15rem;
		vertical-align: baseline;
	}

	.muted {
		margin: 0 0 0.5rem;
		font-size: 0.72rem;
		color: #00296b99;
	}

	.note {
		margin: 0.5rem 0 0;
	}

	.facts {
		margin: 0;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}

	dt {
		font-size: 0.68rem;
		color: #00296b99;
	}

	dd {
		margin: 0.15rem 0 0;
		font-size: 0.95rem;
		font-weight: 700;
	}

	dd small {
		display: block;
		font-size: 0.7rem;
		font-weight: 400;
		color: #00296b99;
	}

	dd small.inline {
		display: inline;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.74rem;
	}

	th {
		text-align: left;
		font-weight: 600;
		color: #00296b99;
		padding: 0.3rem 0.3rem 0.3rem 0;
		border-bottom: 1px solid #00296b1a;
	}

	td {
		padding: 0.28rem 0.3rem 0.28rem 0;
		border-bottom: 1px solid #00296b0d;
	}

	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.barcell {
		width: 22%;
	}

	.barcell span {
		display: block;
		height: 0.45rem;
		border-radius: 0.2rem;
		min-width: 1px;
	}

	.panel.wide {
		width: clamp(26rem, 36vw, 38rem);
	}

	@media (max-width: 768px) {
		.panel,
		.panel.wide {
			width: 100%;
			border-left: none;
			border-top: 1px solid color-mix(in srgb, #00296b 12%, white);
		}
	}
</style>
