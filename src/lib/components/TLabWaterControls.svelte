<script lang="ts">
	import { formatCalendarMonth } from '$lib/waterBudget';
	import { WATER_EMPTY, WATER_PALETTE, compactM3, seasonParts, type TLabWater } from '$lib/tlabWater.svelte';

	interface Props {
		water: TLabWater;
	}

	let { water }: Props = $props();

	let collapsed = $state(false);

	const year = $derived(water.seasonKey ? seasonParts(water.seasonKey).year : null);
	const totals = $derived(water.totals);

	function plotCount(n: number | undefined): string {
		if (n == null) return '';
		return ` · ${n.toLocaleString('en', { notation: 'compact', maximumFractionDigits: 1 })} plots`;
	}
</script>

<div class="ctl" class:collapsed role="region" aria-label="Water budget season and legend">
	<div class="head">
		<span class="title">Water budget</span>
		<button type="button" class="toggle" onclick={() => (collapsed = !collapsed)} aria-expanded={!collapsed}>
			{collapsed ? 'Show' : 'Hide'}
		</button>
	</div>

	{#if !collapsed && water.seasons.length && water.seasonKey}
		<div class="pick">
			<label>
				<span>Year</span>
				<select value={year} onchange={(e) => water.setYear(Number(e.currentTarget.value))}>
					{#each water.years as y}<option value={y}>{y}</option>{/each}
				</select>
			</label>
			<label class="grow">
				<span>Season</span>
				<select value={water.seasonKey} onchange={(e) => water.setSeason(e.currentTarget.value)}>
					{#each year != null ? water.seasonsForYear(year) : [] as s}
						{@const p = seasonParts(s.key)}
						<option value={s.key}>{p.season} · {p.range}{plotCount(s.plots)}</option>
					{/each}
				</select>
			</label>
		</div>

		{#if totals}
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
		{/if}

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
			<p>m³ per cell · equal-count classes · grey = no water need</p>
		</div>
	{/if}
</div>

<style>
	.ctl {
		position: absolute;
		left: 0.75rem;
		bottom: 2.2rem;
		z-index: 800;
		width: 19rem;
		padding: 0.6rem 0.75rem 0.65rem;
		border-radius: 0.6rem;
		background: rgba(255, 255, 255, 0.96);
		box-shadow: 0 4px 16px rgba(0, 41, 107, 0.18);
		font-family: 'Montserrat', sans-serif;
		color: #00296b;
	}

	.ctl.collapsed {
		width: auto;
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.title {
		font-size: 0.78rem;
		font-weight: 700;
	}

	.toggle {
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		font-size: 0.7rem;
		font-weight: 600;
		color: #1b75e0;
		cursor: pointer;
	}

	.pick {
		display: flex;
		gap: 0.4rem;
		margin-top: 0.5rem;
	}

	.pick label {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		font-size: 0.64rem;
		color: #00296b99;
	}

	.pick .grow {
		flex: 1;
		min-width: 0;
	}

	select {
		width: 100%;
		padding: 0.25rem 0.3rem;
		border: 1px solid #00296b26;
		border-radius: 0.35rem;
		background: white;
		font: inherit;
		font-size: 0.72rem;
		color: #00296b;
	}

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

	.legend p {
		margin: 0.2rem 0 0;
		font-size: 0.6rem;
		color: #00296b99;
	}
</style>
