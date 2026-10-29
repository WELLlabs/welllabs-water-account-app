<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cropColor } from '$lib/tlab';
	import { fmtHa } from '$lib/tlabCrops.svelte';
	import { gapiInsight, pinGapiLegend, type TLabGapi } from '$lib/tlabGapi.svelte';
	import { seasonParts } from '$lib/tlabWater.svelte';

	interface Props {
		gapi: TLabGapi;
		seasons: string[];
		onSeason: (key: string) => void;
		/** Selected-cell detail shown above the district insights */
		children?: Snippet;
		/** Wider panel for the selected-cell crop calendar */
		wide?: boolean;
	}

	let { gapi, seasons, onSeason, children, wide = false }: Props = $props();

	const TOP = 6;
	const insight = $derived(gapi.insight);
	const season = $derived(gapi.seasonKey ? seasonParts(gapi.seasonKey) : null);
	const listed = $derived(pinGapiLegend(gapi.district, 12));
	const maxHa = $derived(Math.max(1, listed[0]?.ha ?? 1));

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
				<h2>Google ALU</h2>
				<p class="meta">
					Raichur district{#if season}
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
				<p class="muted">District farm area. Click a bar to show that season on the map.</p>
				<div class="hist">
					{#each bars as b (b.key)}
						<button
							type="button"
							class="hrow"
							class:on={b.key === gapi.seasonKey}
							onclick={() => onSeason(b.key)}
							title="{b.key}: {fmtHa(b.info.identified)} ha identified"
						>
							<span class="hlabel">{b.key}</span>
							<span class="hbar" style:width="{(b.info.farm / maxSum) * 100}%">
								{#each b.parts as p (p.crop)}
									{#if p.ha > 0}<span style:flex-grow={p.ha} style:background={cropColor(p.crop)}></span>{/if}
								{/each}
								{#if b.other > 0}<span style:flex-grow={b.other} style:background="#475569"></span>{/if}
								{#if b.info.unknown > 0}<span style:flex-grow={b.info.unknown} style:background={cropColor('Unknown')}></span>{/if}
								{#if b.info.none > 0}<span style:flex-grow={b.info.none} style:background={cropColor('No prediction')}></span>{/if}
							</span>
							<span class="hval">{fmtHa(b.info.identified)}</span>
						</button>
					{/each}
				</div>
				<div class="key">
					{#each keyCrops as crop}<span><i style:background={cropColor(crop)}></i>{crop}</span>{/each}
					<span><i style:background="#475569"></i>Other</span>
					<span><i style:background={cropColor('Unknown')}></i>Unknown</span>
					<span><i style:background={cropColor('No prediction')}></i>No prediction</span>
				</div>
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

	.hist {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.hrow {
		display: grid;
		grid-template-columns: 5.8rem 1fr 3rem;
		align-items: center;
		gap: 0.4rem;
		border: none;
		background: none;
		padding: 1px 0;
		font: inherit;
		color: inherit;
		cursor: pointer;
		text-align: left;
	}

	.hrow:hover .hlabel,
	.hrow.on .hlabel {
		font-weight: 700;
	}

	.hrow.on .hbar {
		outline: 1.5px solid #e11d48;
		outline-offset: 1px;
	}

	.hlabel {
		font-size: 0.68rem;
		white-space: nowrap;
	}

	.hbar {
		display: flex;
		height: 0.7rem;
		min-width: 2px;
		border-radius: 2px;
		overflow: hidden;
	}

	.hval {
		font-size: 0.66rem;
		text-align: right;
		color: #00296b99;
		font-variant-numeric: tabular-nums;
	}

	.key {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.6rem;
		margin-top: 0.6rem;
		font-size: 0.65rem;
		color: #00296bcc;
	}

	.key i {
		display: inline-block;
		width: 0.55rem;
		height: 0.55rem;
		margin-right: 0.25rem;
		border-radius: 0.1rem;
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
