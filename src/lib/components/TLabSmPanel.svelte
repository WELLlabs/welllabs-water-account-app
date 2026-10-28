<script lang="ts">
	import { SM_BREAKS, SM_PALETTE, smColor, type TLabSoil } from '$lib/tlabSoil.svelte';

	interface Props {
		soil: TLabSoil;
		cellId: string | null;
		cellToken: string | null;
		onClose?: () => void;
	}

	let { soil, cellId, cellToken, onClose }: Props = $props();

	const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	const W = 320;
	const H = 110;
	const AXIS = 24;
	const Y_MAX = 100;
	const CLIM_H = 70;

	const obs = $derived(soil.status === 'done' && cellId ? soil.series(cellId) : []);
	const current = $derived(soil.status === 'done' && cellId ? soil.cellValue(cellId) : null);

	function label(month: string): string {
		return `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
	}

	function formatDay(iso: string): string {
		return new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
	}

	const mean = (vals: number[]) => vals.reduce((s, v) => s + v, 0) / vals.length;

	/** Every calendar month from the first pass to the last, with the mean of its passes */
	const months = $derived.by(() => {
		if (!soil.first || !soil.latest) return [];
		const sums = new Map<string, number[]>();
		for (const o of obs) {
			const m = o.date.slice(0, 7);
			sums.set(m, [...(sums.get(m) ?? []), o.value]);
		}
		const out: { month: string; value: number | null; n: number }[] = [];
		let [y, m] = soil.first.slice(0, 7).split('-').map(Number);
		const end = soil.latest.slice(0, 7);
		for (;;) {
			const key = `${y}-${String(m).padStart(2, '0')}`;
			const vals = sums.get(key);
			out.push({ month: key, value: vals ? mean(vals) : null, n: vals?.length ?? 0 });
			if (key >= end) break;
			m++;
			if (m > 12) {
				m = 1;
				y++;
			}
		}
		return out;
	});
	const valid = $derived(months.filter((m): m is { month: string; value: number; n: number } => m.value != null));

	const stats = $derived.by(() => {
		if (!valid.length) return null;
		return {
			mean: mean(obs.map((o) => o.value)),
			wettest: valid.reduce((a, b) => (b.value > a.value ? b : a)),
			driest: valid.reduce((a, b) => (b.value < a.value ? b : a)),
			passes: obs.length
		};
	});

	const climatology = $derived(
		MONTHS.map((_, m) => {
			const vals = obs.filter((o) => Number(o.date.slice(5, 7)) === m + 1).map((o) => o.value);
			return vals.length ? mean(vals) : null;
		})
	);

	const years = $derived.by(() => {
		const out = new Map<string, number[]>();
		for (const o of obs) out.set(o.date.slice(0, 4), [...(out.get(o.date.slice(0, 4)) ?? []), o.value]);
		return [...out.entries()]
			.map(([year, vals]) => ({ year, mean: mean(vals), low: Math.min(...vals), high: Math.max(...vals), n: vals.length }))
			.sort((a, b) => b.year.localeCompare(a.year));
	});

	const norm = $derived(current ? climatology[Number(current.date.slice(5, 7)) - 1] : null);
	const vsNorm = $derived(current && norm != null ? current.value - norm : null);

	/** The last few passes, newest first */
	const recent = $derived(obs.slice(-8).reverse());

	const chart = $derived.by(() => {
		const bw = (W - AXIS) / Math.max(1, months.length);
		const bars = months.map((p, i) => ({
			...p,
			x: AXIS + i * bw,
			w: Math.max(0.6, bw - 0.4),
			h: p.value == null ? 2 : Math.max(1, (Math.min(p.value, Y_MAX) / Y_MAX) * (H - 4))
		}));
		const yearMarks = months
			.map((p, i) => ({ p, i }))
			.filter(({ p }) => p.month.endsWith('-01'))
			.map(({ p, i }) => ({ year: p.month.slice(0, 4), x: AXIS + i * bw }));
		return { bars, yearMarks: yearMarks.filter((m) => m.x < W - 16) };
	});
	const climMax = $derived(Math.max(5, ...climatology.map((v) => v ?? 0)));

	/** Show the month's last pass on the map */
	function pickMonth(month: string) {
		const last = obs.findLast((o) => o.date.startsWith(month));
		if (last) soil.setDate(last.date);
	}
</script>

<aside class="panel" aria-label="Relative soil moisture {cellId ? 'for the selected cell' : 'district insights'}">
	<header>
		<div class="title">
			<span class="sw" style:background="linear-gradient(135deg, {SM_PALETTE[1]}, {SM_PALETTE[4]}, {SM_PALETTE[7]})"></span>
			<div>
				<h2>Relative soil moisture</h2>
				<p class="meta">
					{#if cellToken}
						Cell {cellToken} · surface, top ~5 cm
						<small>Sentinel-1 radar, mean of the cell's {soil.resolutionM} m pixels</small>
					{:else}
						Raichur district · surface, top ~5 cm
						{#if soil.date}<small>{formatDay(soil.date)} on the map</small>{/if}
					{/if}
				</p>
			</div>
		</div>
		{#if onClose && cellId}
			<button type="button" class="close" onclick={onClose} aria-label="Close relative soil moisture">×</button>
		{/if}
	</header>

	{#if soil.status === 'error'}
		<section><p class="muted">Relative soil moisture unavailable: {soil.error}</p></section>
	{:else if soil.status !== 'done'}
		<section><p class="muted">Loading relative soil moisture…</p></section>
	{:else if !cellId}
		<section>
			<dl class="facts">
				<div class="wide">
					<dt>Map pass</dt>
					<dd class="big">{soil.date ? formatDay(soil.date) : '—'}</dd>
				</div>
				<div>
					<dt>District mean</dt>
					<dd>
						{#if soil.pass?.mean != null}
							<span class="chip" style:background={smColor(soil.pass.mean)}></span>{soil.pass.mean.toFixed(0)}<small class="inline">%</small>
						{:else}—{/if}
					</dd>
				</div>
				<div>
					<dt>District cover</dt>
					<dd>{soil.pass ? `${Math.round(soil.pass.cover * 100)}%` : '—'}</dd>
				</div>
				<div>
					<dt>Passes</dt>
					<dd>{soil.passes.length.toLocaleString('en-IN')}</dd>
				</div>
				<div>
					<dt>Resolution</dt>
					<dd>{soil.resolutionM} m</dd>
				</div>
			</dl>
			<ul class="classes">
				{#each SM_PALETTE as color, i (i)}
					<li>
						<span class="chip sm" style:background={color}></span>
						{#if i === 0}
							&lt; {SM_BREAKS[0]}%
						{:else if i === SM_PALETTE.length - 1}
							≥ {SM_BREAKS.at(-1)}%
						{:else}
							{SM_BREAKS[i - 1]}–{SM_BREAKS[i]}%
						{/if}
					</li>
				{/each}
			</ul>
			<p class="muted">
				Sentinel-1 radar, relative surface wetness of the top ~5 cm. Click a cell for its time series.
			</p>
		</section>
	{:else if !stats}
		<section>
			<p class="muted">
				No relative soil moisture for this cell. Radar can't measure it over towns, rock, open water or where the
				backscatter barely changes through the year.
			</p>
		</section>
	{:else}
		{#if soil.date}
			<section>
				<h3>Map pass · {formatDay(soil.date)}</h3>
				<dl class="facts">
					<div class="wide">
						<dt>Relative surface wetness</dt>
						<dd class="big">
							{#if current}
								<span class="chip" style:background={smColor(current.value)}></span>{current.value}<small class="inline">%</small>
								{#if current.date !== soil.date}<small>Seen on {formatDay(current.date)}; this pass didn't cover the cell</small>{/if}
							{:else}—<small>No pass saw this cell in the {soil.maxAgeDays} days before</small>{/if}
						</dd>
					</div>
					{#if current}
						<div class="wide">
							<dt>Against the {MONTHS[Number(current.date.slice(5, 7)) - 1]} average</dt>
							<dd>
								{#if vsNorm != null && norm != null}
									<span class:wet={vsNorm > 0} class:dry={vsNorm < 0}
										>{vsNorm > 0 ? '+' : ''}{vsNorm.toFixed(0)} points</span
									>
									<small>Average {norm.toFixed(0)}%</small>
								{:else}—{/if}
							</dd>
						</div>
					{/if}
				</dl>
			</section>
		{/if}

		<section>
			<h3>Monthly time series</h3>
			<p class="muted">Mean of the passes in each month. Click a bar to show that month's last pass on the map.</p>
			<svg class="chart" viewBox="0 0 {W} {H + 14}" role="img" aria-label="Monthly mean relative soil moisture for the selected cell">
				{#each [0, 50, 100] as t}
					{@const y = H - (t / Y_MAX) * (H - 4)}
					<line x1={AXIS} x2={W} y1={y} y2={y} class="grid" />
					<text x={AXIS - 4} y={y + 3} class="tick" text-anchor="end">{t}%</text>
				{/each}
				{#each chart.bars as b (b.month)}
					<rect
						x={b.x}
						y={H - b.h}
						width={b.w}
						height={b.h}
						fill={b.value == null ? '#e2e8f0' : smColor(b.value)}
						class="bar"
						class:on={soil.date?.startsWith(b.month)}
						role="presentation"
						onclick={() => pickMonth(b.month)}
					>
						<title
							>{label(b.month)}: {b.value != null
								? `${b.value.toFixed(0)}% (${b.n} pass${b.n === 1 ? '' : 'es'})`
								: 'no pass'}</title
						>
					</rect>
				{/each}
				{#each chart.yearMarks as m}
					<text x={m.x} y={H + 12} class="tick">{m.year}</text>
				{/each}
			</svg>
		</section>

		<section>
			<h3>Latest passes</h3>
			<table>
				<thead><tr><th>Date</th><th class="num">Wetness</th></tr></thead>
				<tbody>
					{#each recent as o (o.date)}
						<tr class:sel={o.date === current?.date}>
							<td>
								<button type="button" class="day" onclick={() => soil.setDate(o.date)}>{formatDay(o.date)}</button>
							</td>
							<td class="num"><span class="chip sm" style:background={smColor(o.value)}></span>{o.value}%</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>

		<section>
			<h3>Summary</h3>
			<dl class="facts">
				<div><dt>Mean of all passes</dt><dd>{stats.mean.toFixed(0)}<small class="inline">%</small></dd></div>
				<div><dt>Passes with data</dt><dd>{stats.passes.toLocaleString('en-IN')}</dd></div>
				<div>
					<dt>Wettest month</dt>
					<dd>{stats.wettest.value.toFixed(0)}%<small>{label(stats.wettest.month)}</small></dd>
				</div>
				<div>
					<dt>Driest month</dt>
					<dd>{stats.driest.value.toFixed(0)}%<small>{label(stats.driest.month)}</small></dd>
				</div>
			</dl>
		</section>

		<section>
			<h3>Average by month</h3>
			<p class="muted">Mean of every pass in each calendar month across all years.</p>
			<div class="clim" style:height="{CLIM_H}px">
				{#each climatology as v, m}
					<div
						class="clim-col"
						class:on={soil.date != null && Number(soil.date.slice(5, 7)) === m + 1}
						title="{MONTHS[m]}: {v != null ? `${v.toFixed(0)}%` : 'no data'}"
					>
						<div class="clim-bar" style:height="{((v ?? 0) / climMax) * 100}%" style:background={smColor(v)}></div>
						<span>{MONTHS[m][0]}</span>
					</div>
				{/each}
			</div>
		</section>

		<section>
			<h3>By year</h3>
			<table>
				<thead>
					<tr><th>Year</th><th class="num">Mean</th><th class="num">Driest</th><th class="num">Wettest</th><th class="num">Passes</th></tr>
				</thead>
				<tbody>
					{#each years as y (y.year)}
						<tr>
							<td>{y.year}</td>
							<td class="num">{y.mean.toFixed(0)}%</td>
							<td class="num">{y.low}%</td>
							<td class="num">{y.high}%</td>
							<td class="num">{y.n}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>

		<section>
			<p class="muted">
				Wetness is relative: 0% is the driest and 100% the wettest this spot has been in the record, read from
				how strongly the soil reflects radar. Crops and flooded paddies also change the signal, so read it
				alongside the season.
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

	.close {
		border: none;
		background: none;
		font-size: 1.5rem;
		line-height: 1;
		color: #00296b99;
		cursor: pointer;
		padding: 0 0.2rem;
	}

	.close:hover {
		color: #00296b;
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
		width: 0.8rem;
		height: 0.8rem;
		margin-right: 0.35rem;
		border-radius: 0.2rem;
		vertical-align: baseline;
	}

	.chip.sm {
		width: 0.6rem;
		height: 0.6rem;
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

	.classes {
		list-style: none;
		margin: 0.75rem 0 0.5rem;
		padding: 0;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.2rem 0.6rem;
		font-size: 0.72rem;
	}

	.classes li {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	dt {
		font-size: 0.68rem;
		color: #00296b99;
	}

	dd {
		margin: 0.15rem 0 0;
		font-size: 0.9rem;
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

	.wet {
		color: #01665e;
	}

	.dry {
		color: #8c510a;
	}

	.chart {
		width: 100%;
		height: auto;
		display: block;
	}

	.grid {
		stroke: #00296b14;
		stroke-width: 0.5;
	}

	.tick {
		font-size: 7px;
		fill: #00296b99;
	}

	.bar {
		cursor: pointer;
	}

	.bar:hover {
		opacity: 0.75;
	}

	.bar.on {
		stroke: #e11d48;
		stroke-width: 1.2;
	}

	.clim {
		display: flex;
		align-items: flex-end;
		gap: 3px;
		padding-bottom: 1rem;
	}

	.clim-col {
		position: relative;
		flex: 1;
		height: 100%;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
	}

	.clim-bar {
		min-height: 1px;
		border-radius: 2px 2px 0 0;
	}

	.clim-col.on .clim-bar {
		outline: 1.5px solid #e11d48;
	}

	.clim-col span {
		position: absolute;
		bottom: -1rem;
		left: 50%;
		translate: -50% 0;
		font-size: 0.6rem;
		color: #00296b99;
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
		padding: 0.3rem 0.3rem 0.3rem 0;
		border-bottom: 1px solid #00296b0d;
	}

	tr.sel td {
		font-weight: 700;
	}

	.day {
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		color: inherit;
		cursor: pointer;
		text-decoration: underline dotted #00296b66;
	}

	.num {
		text-align: right;
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
