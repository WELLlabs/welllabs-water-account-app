<script lang="ts">
	import {
		ET_COLORS,
		PCP_COLORS,
		NPP_COLORS,
		TBP_COLORS,
		GBWP_COLORS,
		pcpColor,
		nppColor,
		tbpColor,
		gbwpColor,
		type EtPoint
	} from '$lib/tlab';

	export type HydroPanelMode = 'et' | 'rain' | 'npp' | 'biomass' | 'wp';

	interface Props {
		cellToken: string | null;
		/** Every period the layer covers, oldest first (YYYY-MM or YYYY) */
		months: string[];
		series: EtPoint[] | null;
		loading: boolean;
		error: string | null;
		/** Index into `months` of the period shown on the map */
		idx: number;
		/** Footer attribution; NRSC by default, WaPOR when that layer is on */
		sourceNote?: string;
		mode?: HydroPanelMode;
		onClose?: () => void;
	}

	let {
		cellToken,
		months,
		series,
		loading,
		error,
		idx = $bindable(),
		sourceNote = 'NRSC Bhuvan NHP actual ET (SNPP-VIIRS energy balance), 750 m.',
		mode = 'et',
		onClose
	}: Props = $props();

	const spec = $derived(
		{
			et: {
				title: 'Evapotranspiration',
				noun: 'actual ET',
				unit: 'mm/day',
				unitMonth: 'mm',
				palette: ET_COLORS,
				color: (v: number | null) =>
					v == null ? '#cbd5e1' : ET_COLORS[Math.min(ET_COLORS.length - 1, Math.max(0, Math.floor(v)))],
				format: (v: number) => v.toFixed(2),
				yMin: 8,
				yStep: 2,
				temporal: 'month' as const,
				dual: true
			},
			rain: {
				title: 'Precipitation',
				noun: 'rainfall',
				unit: 'mm',
				unitMonth: 'mm',
				palette: PCP_COLORS,
				color: pcpColor,
				format: (v: number) => v.toFixed(0),
				yMin: 80,
				yStep: 50,
				temporal: 'month' as const,
				dual: true
			},
			npp: {
				title: 'Net primary production',
				noun: 'NPP',
				unit: 'gC/m²',
				unitMonth: 'gC/m²',
				palette: NPP_COLORS,
				color: nppColor,
				format: (v: number) => v.toFixed(1),
				yMin: 40,
				yStep: 20,
				temporal: 'month' as const,
				dual: false
			},
			biomass: {
				title: 'Biomass',
				noun: 'total biomass',
				unit: 'kg/ha',
				unitMonth: 'kg/ha',
				palette: TBP_COLORS,
				color: tbpColor,
				format: (v: number) => Math.round(v).toLocaleString('en-IN'),
				yMin: 4000,
				yStep: 2000,
				temporal: 'year' as const,
				dual: false
			},
			wp: {
				title: 'Water productivity',
				noun: 'gross biomass WP',
				unit: 'kg/m³',
				unitMonth: 'kg/m³',
				palette: GBWP_COLORS,
				color: gbwpColor,
				format: (v: number) => v.toFixed(2),
				yMin: 1.5,
				yStep: 0.5,
				temporal: 'year' as const,
				dual: false
			}
		}[mode]
	);

	const rain = $derived(mode === 'rain');
	const annual = $derived(spec.temporal === 'year');
	const palette = $derived(spec.palette);

	const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	const W = 320;
	const H = 110;
	const AXIS = 22;
	const CLIM_H = 70;

	function daysIn(month: string): number {
		return new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
	}

	function label(period: string): string {
		if (period.length === 4) return period;
		const m = Number(period.slice(5, 7));
		if (!m) return period;
		return `${MONTHS[m - 1]} ${period.slice(0, 4)}`;
	}

	function color(v: number | null): string {
		return spec.color(v);
	}

	function monthTotal(v: number, month: string): number {
		if (mode === 'et') return v * daysIn(month);
		return v;
	}

	function daily(v: number, month: string): number {
		if (mode === 'et') return v;
		return v / daysIn(month);
	}

	function fmtPrimary(v: number): string {
		return spec.format(v);
	}

	function fmtTick(t: number): string {
		if (mode === 'biomass') return t >= 1000 ? `${Math.round(t / 1000)}k` : String(t);
		if (mode === 'wp') return Number.isInteger(t) ? String(t) : t.toFixed(1);
		return String(t);
	}

	const points = $derived.by(() => {
		const byMonth = new Map((series ?? []).map((p) => [p.month, p]));
		return months.map((month) => {
			const p = byMonth.get(month);
			return { month, value: p?.value ?? null, status: p?.status ?? 'missing' };
		});
	});
	const valid = $derived(points.filter((p): p is { month: string; value: number; status: EtPoint['status'] } => p.value != null));

	const stats = $derived.by(() => {
		if (!valid.length) return null;
		const mean = valid.reduce((s, p) => s + p.value, 0) / valid.length;
		const peak = valid.reduce((a, b) => (b.value > a.value ? b : a));
		const low = valid.reduce((a, b) => (b.value < a.value ? b : a));
		return { mean, peak, low, latest: valid[valid.length - 1] };
	});

	const years = $derived.by(() => {
		const out = new Map<string, { year: string; n: number; total: number; sum: number }>();
		for (const p of valid) {
			const year = p.month.slice(0, 4);
			const y = out.get(year) ?? { year, n: 0, total: 0, sum: 0 };
			y.n++;
			y.total += monthTotal(p.value, p.month);
			y.sum += p.value;
			out.set(year, y);
		}
		return [...out.values()].sort((a, b) => b.year.localeCompare(a.year));
	});
	const fullYears = $derived(years.filter((y) => y.n === 12));
	const annualMean = $derived(fullYears.length ? fullYears.reduce((s, y) => s + y.total, 0) / fullYears.length : null);

	/** Mean mm/day for each calendar month across all years with data */
	const climatology = $derived(
		MONTHS.map((_, m) => {
			const vals = valid.filter((p) => Number(p.month.slice(5, 7)) === m + 1).map((p) => p.value);
			return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
		})
	);

	const current = $derived(points[idx] ?? null);
	const currentNorm = $derived(
		annual
			? (stats?.mean ?? null)
			: current
				? climatology[Number(current.month.slice(5, 7)) - 1]
				: null
	);
	const vsNorm = $derived(
		current?.value != null && currentNorm ? ((current.value - currentNorm) / currentNorm) * 100 : null
	);

	const yMax = $derived(Math.max(spec.yMin, Math.ceil((stats?.peak.value ?? 0) / spec.yStep) * spec.yStep));
	const chart = $derived.by(() => {
		const bw = (W - AXIS) / Math.max(1, points.length);
		const bars = points.map((p, i) => ({
			...p,
			i,
			x: AXIS + i * bw,
			w: Math.max(0.6, bw - 0.4),
			h: p.value == null ? 2 : Math.max(1, (p.value / yMax) * (H - 4))
		}));
		const yearMarks = points
			.map((p, i) => ({ p, i }))
			.filter(({ p }) => annual || p.month.endsWith('-01'))
			.map(({ p, i }) => ({ year: p.month.slice(0, 4), x: AXIS + i * bw }));
		const step = yearMarks.length > 8 ? 2 : 1;
		return { bars, yearMarks: yearMarks.filter((_, i) => i % step === 0 && _.x < W - 16) };
	});
	const climMax = $derived(Math.max(1, ...climatology.map((v) => v ?? 0)));
	const gaps = $derived(points.length - valid.length);
</script>

<aside class="panel" aria-label="{spec.title} {cellToken ? 'for the selected cell' : 'district insights'}">
	<header>
		<div class="title">
			<span class="sw" style:background="linear-gradient(135deg, {palette[0]}, {palette[4]}, {palette[9]})"></span>
			<div>
				<h2>{spec.title}</h2>
				<p class="meta">
					{#if cellToken}
						Cell {cellToken} · {annual ? 'annual' : 'monthly'} {spec.noun} at the cell centre
					{:else}
						Raichur district · {annual ? 'annual' : 'monthly'} {spec.noun}
						{#if months[idx]}<small>{label(months[idx])} on the map</small>{/if}
					{/if}
				</p>
			</div>
		</div>
		{#if onClose && cellToken}
			<button type="button" class="close" onclick={onClose} aria-label="Close {spec.title}">×</button>
		{/if}
	</header>

	{#if !cellToken}
		<section>
			<dl class="facts">
				<div class="wide">
					<dt>Map period</dt>
					<dd class="big">{months[idx] ? label(months[idx]) : '—'}</dd>
				</div>
				<div>
					<dt>Periods</dt>
					<dd>{months.length.toLocaleString('en-IN')}</dd>
				</div>
				<div>
					<dt>Unit</dt>
					<dd>{spec.unit}</dd>
				</div>
			</dl>
			<div class="ramp" aria-hidden="true">
				{#each palette as c}<span style:background={c}></span>{/each}
			</div>
			<p class="muted">
				District map for this {annual ? 'year' : 'month'}. Click a cell for the time series at its centre.
			</p>
			<p class="muted">{sourceNote}</p>
		</section>
	{:else if error}
		<section><p class="err">{error}</p></section>
	{:else if !stats && loading}
		<section><p class="muted">Loading {spec.noun} history for this cell…</p></section>
	{:else if !stats}
		<section><p class="muted">No {spec.noun} values for this cell.</p></section>
	{:else}
		{#if current}
			<section>
				<h3>{label(current.month)}</h3>
				<dl class="facts">
					<div>
						<dt>{spec.dual ? (rain ? 'Month total' : 'Daily ET') : annual ? (mode === 'wp' ? 'Annual GBWP' : 'Year total') : 'Month total'}</dt>
						<dd class="big">
							{#if current.value != null}
								{fmtPrimary(current.value)}
								<small class="inline">{spec.unit}</small>
							{:else}
								<small class="inline">{current.status === 'cloud' ? 'Cloud' : 'No data'}</small>
							{/if}
						</dd>
					</div>
					{#if spec.dual}
						<div>
							<dt>{rain ? 'Mean daily' : 'Month total'}</dt>
							<dd class="big">
								{#if current.value != null}
									{rain
										? daily(current.value, current.month).toFixed(2)
										: Math.round(monthTotal(current.value, current.month))}
									<small class="inline">{rain ? 'mm/day' : 'mm'}</small>
								{:else}—{/if}
							</dd>
						</div>
					{:else if !annual && current.value != null}
						<div>
							<dt>Mean daily</dt>
							<dd class="big">
								{daily(current.value, current.month).toFixed(2)}
								<small class="inline">{spec.unit}/day</small>
							</dd>
						</div>
					{/if}
					<div class="wide">
						<dt>
							{annual
								? 'Against the long-term mean'
								: `Against the ${MONTHS[Number(current.month.slice(5, 7)) - 1]} average`}
						</dt>
						<dd>
							{#if vsNorm != null && currentNorm != null}
								<span class:up={vsNorm > 0} class:down={vsNorm < 0}>{vsNorm > 0 ? '+' : ''}{vsNorm.toFixed(0)}%</span>
								<small>Average {fmtPrimary(currentNorm)} {spec.unit}</small>
							{:else}—{/if}
						</dd>
					</div>
				</dl>
			</section>
		{/if}

		<section>
			<h3>{annual ? 'Annual time series' : 'Monthly time series'}</h3>
			<p class="muted">Click a bar to show that {annual ? 'year' : 'month'} on the map. Grey = no data.</p>
			<svg class="chart" viewBox="0 0 {W} {H + 14}" role="img" aria-label="{annual ? 'Annual' : 'Monthly'} {spec.noun} for the selected cell">
				{#each [0, yMax / 2, yMax] as t}
					{@const y = H - (t / yMax) * (H - 4)}
					<line x1={AXIS} x2={W} y1={y} y2={y} class="grid" />
					<text x={AXIS - 4} y={y + 3} class="tick" text-anchor="end">{fmtTick(t)}</text>
				{/each}
				{#each chart.bars as b (b.month)}
					<rect
						x={b.x}
						y={H - b.h}
						width={b.w}
						height={b.h}
						fill={color(b.value)}
						class="bar"
						class:on={b.i === idx}
						role="presentation"
						onclick={() => (idx = b.i)}
					>
						<title>
							{label(b.month)}: {b.value != null ? `${fmtPrimary(b.value)} ${spec.unit}` : b.status}
						</title>
					</rect>
				{/each}
				{#each chart.yearMarks as m}
					<text x={m.x} y={H + 12} class="tick">{m.year}</text>
				{/each}
			</svg>
			<p class="axis-note">{spec.unit}</p>
		</section>

		<section>
			<h3>Summary</h3>
			<dl class="facts">
				<div>
					<dt>Long-term mean</dt>
					<dd>{fmtPrimary(stats.mean)} <small class="inline">{spec.unit}</small></dd>
				</div>
				{#if !annual}
					<div>
						<dt>Average year</dt>
						<dd>
							{#if annualMean != null}{spec.format(annualMean)} <small class="inline">{spec.unitMonth}</small>
								<small>{fullYears.length} complete year{fullYears.length === 1 ? '' : 's'}</small>
							{:else}—{/if}
						</dd>
					</div>
				{/if}
				<div>
					<dt>Highest {annual ? 'year' : 'month'}</dt>
					<dd>
						{fmtPrimary(stats.peak.value)} <small class="inline">{spec.unit}</small>
						<small>{label(stats.peak.month)}</small>
					</dd>
				</div>
				<div>
					<dt>Lowest {annual ? 'year' : 'month'}</dt>
					<dd>
						{fmtPrimary(stats.low.value)} <small class="inline">{spec.unit}</small>
						<small>{label(stats.low.month)}</small>
					</dd>
				</div>
				<div>
					<dt>Latest with data</dt>
					<dd>
						{fmtPrimary(stats.latest.value)} <small class="inline">{spec.unit}</small>
						<small>{label(stats.latest.month)}</small>
					</dd>
				</div>
				<div>
					<dt>{annual ? 'Years' : 'Months'} with data</dt>
					<dd>{valid.length} <small class="inline">of {points.length}</small><small>{gaps} missing</small></dd>
				</div>
			</dl>
		</section>

		{#if !annual}
			<section>
				<h3>Average by month</h3>
				<p class="muted">
					Mean {rain ? 'monthly rainfall' : mode === 'npp' ? 'monthly NPP' : 'daily ET'} for each calendar month across all years.
				</p>
				<div class="clim" style:height="{CLIM_H}px">
					{#each climatology as v, m}
						<div
							class="clim-col"
							class:on={current != null && Number(current.month.slice(5, 7)) === m + 1}
							title="{MONTHS[m]}: {v != null ? `${fmtPrimary(v)} ${spec.unit}` : 'no data'}"
						>
							<div class="clim-bar" style:height="{((v ?? 0) / climMax) * 100}%" style:background={color(v)}></div>
							<span>{MONTHS[m][0]}</span>
						</div>
					{/each}
				</div>
			</section>

			<section>
				<h3>By year</h3>
				<table>
					<thead>
						<tr>
							<th>Year</th>
							<th class="num">Months</th>
							<th class="num">Total {spec.unitMonth}</th>
							<th class="num">{spec.unit}</th>
						</tr>
					</thead>
					<tbody>
						{#each years as y (y.year)}
							<tr class:partial={y.n < 12}>
								<td>{y.year}</td>
								<td class="num">{y.n}</td>
								<td class="num">{spec.format(y.total)}</td>
								<td class="num">{spec.format(y.sum / y.n)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
				<p class="muted mt">Totals only add months with data, so years with fewer than 12 months (in grey) undercount.</p>
			</section>
		{/if}

		<section>
			{#if loading}
				<p class="muted">Loading older {annual ? 'years' : 'months'}…</p>
			{/if}
			<p class="muted">{sourceNote}</p>
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

	.ramp {
		display: flex;
		height: 0.55rem;
		border-radius: 2px;
		overflow: hidden;
		margin: 0.7rem 0 0.5rem;
	}

	.ramp span {
		flex: 1;
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

	.muted {
		margin: 0 0 0.5rem;
		font-size: 0.72rem;
		color: #00296b99;
	}

	.mt {
		margin-top: 0.6rem;
	}

	.err {
		margin: 0;
		font-size: 0.78rem;
		color: #b91c1c;
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

	.up {
		color: #1d4ed8;
	}

	.down {
		color: #b45309;
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

	.axis-note {
		margin: 0.1rem 0 0;
		font-size: 0.62rem;
		color: #00296b80;
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

	tr.partial td {
		color: #00296b80;
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
