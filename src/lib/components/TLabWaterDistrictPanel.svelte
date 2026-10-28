<script lang="ts">
	import { fmt } from '$lib/components/cropcalc/format';
	import { formatCalendarMonth } from '$lib/waterBudget';
	import { WATER_EMPTY, WATER_PALETTE, compactM3, seasonParts, type TLabWater } from '$lib/tlabWater.svelte';

	interface Props {
		water: TLabWater;
		onSeason: (key: string) => void;
	}

	let { water, onSeason }: Props = $props();

	const season = $derived(water.seasonKey ? seasonParts(water.seasonKey) : null);
	const totals = $derived(water.totals);
	const values = $derived([...water.byCell.values()]);
	const withNeed = $derived(values.filter((v) => v > 0));
	const cells = $derived(water.byCell.size);
	const maxM3 = $derived(Math.max(0, ...withNeed));

	const classes = $derived.by(() => {
		const breaks = water.breaks;
		const counts = WATER_PALETTE.map(() => 0);
		for (const v of withNeed) {
			let i = 0;
			while (i < breaks.length && v > breaks[i]) i++;
			counts[Math.min(i, counts.length - 1)]++;
		}
		return WATER_PALETTE.map((color, i) => ({
			color,
			n: counts[i],
			label:
				i === 0
					? `≤ ${compactM3(breaks[0] ?? 0)}`
					: i === WATER_PALETTE.length - 1
						? `> ${compactM3(breaks[breaks.length - 1] ?? 0)}`
						: `${compactM3(breaks[i - 1] ?? 0)}–${compactM3(breaks[i] ?? 0)}`
		}));
	});

	const bars = $derived(water.seasons.filter((s) => s.m3 > 0 || s.plots > 0));
	const maxSum = $derived(Math.max(1, ...bars.map((b) => b.m3)));
</script>

<aside class="panel" aria-label="Water budget district insights">
	<header>
		<div class="title">
			<span class="sw" style:background="linear-gradient(135deg, {WATER_PALETTE[1]}, {WATER_PALETTE[4]})"></span>
			<div>
				<h2>Water budget</h2>
				<p class="meta">
					Raichur district{#if season}
						· {season.season} {season.year}
						<small>{season.range}</small>
					{/if}
				</p>
			</div>
		</div>
	</header>

	{#if water.status === 'error'}
		<section><p class="muted">Water budget unavailable: {water.error}</p></section>
	{:else if water.status !== 'done' || !totals}
		<section><p class="muted">Loading district water need…</p></section>
	{:else}
		<section>
			<dl class="facts">
				<div class="wide">
					<dt>Water needed</dt>
					<dd class="big">{fmt(totals.m3)} <small class="inline">m³</small></dd>
				</div>
				<div>
					<dt>Plots with a crop</dt>
					<dd>{fmt(totals.plots)}</dd>
				</div>
				<div>
					<dt>Cells with water need</dt>
					<dd>
						{fmt(withNeed.length)}
						<small>of {fmt(cells)}</small>
					</dd>
				</div>
				<div>
					<dt>Peak month</dt>
					<dd>
						{#if totals.peak && totals.peak.m3 > 0}
							{formatCalendarMonth(totals.peak.calendarMonth, totals.peak.calendarYear)}
							<small>{fmt(totals.peak.m3)} m³</small>
						{:else}—{/if}
					</dd>
				</div>
				<div>
					<dt>Highest cell</dt>
					<dd>{maxM3 > 0 ? fmt(maxM3) : '—'} <small class="inline">m³</small></dd>
				</div>
			</dl>
		</section>

		<section>
			<h3>Map classes</h3>
			<p class="muted">Equal-count classes of cell water need. Grey cells have no budgeted crop.</p>
			<ul class="classes">
				<li>
					<span class="chip" style:background={WATER_EMPTY}></span>
					No water need
					<span class="n">{fmt(cells - withNeed.length)}</span>
				</li>
				{#each classes as c, i (i)}
					<li>
						<span class="chip" style:background={c.color}></span>
						{c.label} m³
						<span class="n">{fmt(c.n)}</span>
					</li>
				{/each}
			</ul>
		</section>

		{#if bars.length}
			<section>
				<h3>Every season</h3>
				<p class="muted">District crop water need. Click a bar to show that season on the map.</p>
				<div class="hist">
					{#each bars as b (b.key)}
						<button
							type="button"
							class="hrow"
							class:on={b.key === water.seasonKey}
							onclick={() => onSeason(b.key)}
							title="{b.key}: {fmt(b.m3)} m³ · {fmt(b.plots)} plots"
						>
							<span class="hlabel">{b.key}</span>
							<span class="hbar" style:width="{(b.m3 / maxSum) * 100}%">
								<span style:flex-grow={Math.max(b.m3, 1)} style:background={WATER_PALETTE[3]}></span>
							</span>
							<span class="hval">{compactM3(b.m3)}</span>
						</button>
					{/each}
				</div>
			</section>
		{/if}

		<section>
			<p class="muted">
				Google ALU crops × WELL Labs crop water budgets. Year and season are on the map. Click a cell for
				plot-level need.
			</p>
		</section>
	{/if}
</aside>

<style>
	.panel {
		width: 23rem;
		flex-shrink: 0;
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

	.facts {
		margin: 0;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}

	.facts .wide {
		grid-column: 1 / -1;
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

	dd.big {
		font-size: 1.35rem;
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

	.classes {
		list-style: none;
		margin: 0;
		padding: 0;
		font-size: 0.74rem;
	}

	.classes li {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.2rem 0;
		border-bottom: 1px solid #00296b0d;
	}

	.classes .n {
		margin-left: auto;
		font-variant-numeric: tabular-nums;
		color: #00296b99;
	}

	.hist {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.hrow {
		display: grid;
		grid-template-columns: 5.8rem 1fr 2.8rem;
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

	@media (max-width: 768px) {
		.panel {
			width: 100%;
			border-left: none;
			border-top: 1px solid color-mix(in srgb, #00296b 12%, white);
		}
	}
</style>
