<script lang="ts">
	import { cropColor } from '$lib/tlab';
	import type { GapiCropHa } from '$lib/tlabGapi.svelte';
	import TLabSeasonChart, { seasonSlot, sortSeasonColumns, type SeasonColumn } from './TLabSeasonChart.svelte';
	import {
		REVENUE_PALETTE,
		compactRupees,
		formatRupees,
		type CropRevenue,
		type MarketLevel,
		type TLabMarket
	} from '$lib/tlabMarket.svelte';
	import { seasonParts } from '$lib/tlabWater.svelte';

	interface Props {
		market: TLabMarket;
		regionName: string;
		/** Clicked cell, with its S2 token for display */
		cellId: string | null;
		cellToken: string | null;
		plotsLoading: boolean;
		plotsError: string | null;
		onRetry: () => void;
		/** Reopen the cell panel after it was closed */
		onOpenCell?: () => void;
		/** Region crop mix per season (Google ALU), for the every-season chart */
		seasonMix?: Map<string, GapiCropHa[]>;
		onSeason?: (key: string) => void;
	}

	let { market, regionName, cellId, cellToken, plotsLoading, plotsError, onRetry, onOpenCell, seasonMix, onSeason }: Props =
		$props();

	const season = $derived(market.seasonKey ? seasonParts(market.seasonKey) : null);
	const data = $derived(market.data);
	const totals = $derived(market.totals);
	const cellRevenue = $derived(cellId ? (market.byCell.get(cellId) ?? 0) : 0);
	const IDLE = new Set(['Unknown', 'No prediction', 'Fallow', 'Harvested', 'Uncertain']);
	const crops = $derived(market.byCrop.filter((c) => !IDLE.has(c.crop)));
	const idleHa = $derived(market.byCrop.filter((c) => IDLE.has(c.crop)).reduce((s, c) => s + c.ha, 0));
	const unmatched = $derived(crops.filter((c) => !c.market));

	/** Revenue each season would bring at today's prices and yields, stacked by crop */
	const seasonColumns = $derived.by((): { columns: SeasonColumn[]; legend: { color: string; label: string }[] } => {
		if (!seasonMix || !market.rates.size) return { columns: [], legend: [] };
		const keys = sortSeasonColumns([...seasonMix.keys()].map((key) => ({ key })));
		const sums = new Map<string, number>();
		for (const { key } of keys)
			for (const a of seasonMix.get(key) ?? []) sums.set(a.crop, (sums.get(a.crop) ?? 0) + a.ha * (market.rates.get(a.crop) ?? 0));
		const top = [...sums].filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([c]) => c);
		const columns = keys.map(({ key }) => {
			const mix = seasonMix.get(key) ?? [];
			const by = new Map(mix.map((a) => [a.crop, a.ha * (market.rates.get(a.crop) ?? 0)]));
			const total = [...by.values()].reduce((x, y) => x + y, 0);
			const named = top.reduce((x, c) => x + (by.get(c) ?? 0), 0);
			const slot = seasonSlot(key);
			return {
				key,
				short: slot.short,
				group: slot.group,
				total,
				segments: [
					...top.map((c) => ({ color: cropColor(c), value: by.get(c) ?? 0 })),
					{ color: '#475569', value: Math.max(0, total - named) }
				],
				title: `${key}: ${formatRupees(total)}`
			};
		});
		return {
			columns: columns.some((c) => c.total > 0) ? columns : [],
			legend: [...top.map((c) => ({ color: cropColor(c), label: c })), { color: '#475569', label: 'Other' }]
		};
	});

	const LEVEL: Record<MarketLevel, string> = { district: 'District', state: 'State', india: 'India' };
	const ha = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: v < 10 ? 1 : 0 });
	const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

	function priceNote(c: CropRevenue): string {
		const p = c.market?.price;
		if (!p) return 'No mandi price in the last 30 days';
		return `${LEVEL[p.level]} median of ${p.reports.toLocaleString('en-IN')} reports, ${p.markets} mandi${p.markets === 1 ? '' : 's'}, ${day(p.from)}–${day(p.to)}`;
	}

	function yieldNote(c: CropRevenue): string {
		const y = c.market?.yield;
		if (!y) return 'No DES yield';
		const where = y.level === 'district' ? y.place : y.level === 'state' ? `${y.place} (state)` : 'India';
		const yearly = (y.series ?? []).map(([yr, area, prod]) => `${yr}: ${(prod / area).toFixed(1)}`);
		return yearly.length
			? `${where} DES median of ${yearly.join(' · ')} = ${y.value} q/ha`
			: `${where} DES median, ${y.value} q/ha`;
	}

	/** Priced crops, largest first; one is worked through the formulas */
	const priced = $derived(crops.filter((c) => c.rate && c.yieldQha).sort((a, b) => b.revenue - a.revenue));
	let pickCrop = $state<string | null>(null);
	const worked = $derived(priced.find((c) => c.crop === pickCrop) ?? priced[0] ?? null);
	const UNIT: Record<string, string> = { Cotton: 'kapas', Rice: 'paddy' };

	const coverage = $derived(data?.coverage ?? null);
	const filling = $derived(coverage ? coverage.days < coverage.windowDays - 2 : false);
</script>

<aside class="panel" aria-label="Market revenue insights">
	<header>
		<div class="title">
			<span class="sw" style:background="linear-gradient(135deg, {REVENUE_PALETTE[1]}, {REVENUE_PALETTE[4]})"></span>
			<div>
				<h2>Market revenue</h2>
				<p class="meta">
					{regionName}{#if season}
						· {season.season} {season.year}
						<small>{season.range}</small>
					{/if}
				</p>
			</div>
		</div>
	</header>

	{#if market.status === 'error'}
		<section>
			<p class="muted">Mandi prices unavailable: {market.error}</p>
			<button type="button" class="link" onclick={onRetry}>Try again</button>
		</section>
	{:else if market.status !== 'done' || !data}
		<section><p class="muted">Loading mandi prices and crop yields… data.gov.in can take a minute.</p></section>
	{:else}
		<section>
			<dl class="facts">
				<div class="wide">
					<dt>Gross crop revenue</dt>
					<dd class="big">{formatRupees(totals.revenue)}</dd>
				</div>
				<div>
					<dt>Priced crop area</dt>
					<dd>{ha(totals.pricedHa)} <small class="inline">ha</small></dd>
				</div>
				<div>
					<dt>Per priced hectare</dt>
					<dd>{totals.pricedHa ? formatRupees(totals.revenue / totals.pricedHa) : '—'}</dd>
				</div>
				<div>
					<dt>Cells with revenue</dt>
					<dd>{totals.cells.toLocaleString('en-IN')} <small>of {market.byCell.size.toLocaleString('en-IN')}</small></dd>
				</div>
				<div>
					<dt>Highest cell</dt>
					<dd>{totals.maxCell ? formatRupees(totals.maxCell) : '—'}</dd>
				</div>
			</dl>
			<p class="muted note">
				Detected crop area × yield × mandi price, before costs. Unknown and No prediction areas
				({ha(idleHa)} ha) earn nothing here.
			</p>
		</section>

		{#if cellId}
			<section class="cell">
				<h3>Cell {cellToken ?? cellId}</h3>
				<p class="cell-total">{formatRupees(cellRevenue)}</p>
				{#if onOpenCell}
					<button type="button" class="link" onclick={onOpenCell}>Open crop level, overall and plot revenue</button>
				{:else if plotsLoading}
					<p class="muted">Loading this cell's plots from Google…</p>
				{:else if plotsError}
					<p class="muted">{plotsError}</p>
				{/if}
			</section>
		{:else}
			<section><p class="muted">Click a cell for its revenue by crop, overall and by plot.</p></section>
		{/if}

		<section>
			<div class="method top">
				<strong>How revenue is worked out</strong>
				<p class="formula">Revenue = area (ha) × yield (q/ha) × mandi price (₹/q)</p>
				<p class="formula">Default yield = median of yearly (production ÷ area)</p>
				{#if worked}
					{@const c = worked}
					{@const y = c.market?.yield}
					{@const p = c.market?.price?.value ?? 0}
					<label class="pick">
						Worked for
						<select value={c.crop} onchange={(e) => (pickCrop = e.currentTarget.value)}>
							{#each priced as o (o.crop)}<option value={o.crop}>{o.crop}</option>{/each}
						</select>
					</label>
					{#if y?.series?.length}
						<table class="work">
							<thead>
								<tr>
									<th>Year</th>
									<th class="num">Production (q{UNIT[c.crop] ? `, ${UNIT[c.crop]}` : ''})</th>
									<th class="num">Area (ha)</th>
									<th class="num">Yield (q/ha)</th>
								</tr>
							</thead>
							<tbody>
								{#each y.series as [yr, area, prod] (yr)}
									<tr>
										<td>{yr}</td>
										<td class="num">{prod.toLocaleString('en-IN')}</td>
										<td class="num">{area.toLocaleString('en-IN')}</td>
										<td class="num">{(prod / area).toFixed(1)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
						<p class="formula">
							{y.level === 'district' ? y.place : y.level === 'state' ? `${y.place} (state)` : 'India'} median =
							<strong>{y.value} q/ha</strong>{#if c.manualYield}; you set {c.yieldQha} q/ha{/if}
						</p>
					{/if}
				{/if}
				<p class="fine">
					DES yields for {data.districts[0]?.district ?? 'the district'}, else {data.state}, else India. Cotton as kapas
					(lint ÷ 0.34), rice as paddy (milled ÷ 0.67). Type a yield below to override.
				</p>
			</div>
		</section>

		<section>
			<h3>By crop</h3>
			<ul class="crops">
				{#each crops as c (c.crop)}
					<li class:unpriced={!c.rate}>
						<div class="crop-head">
							<strong>{c.crop}</strong>
							<span class="n">{c.rate ? formatRupees(c.revenue) : '—'}</span>
						</div>
						<div class="crop-line">
							{ha(c.ha)} ha ×
							{#if c.market}
								<label class="yield-input" class:manual={c.manualYield} title="Yield in quintals per hectare; type your own figure">
									<input
										type="number"
										min="0"
										step="0.1"
										inputmode="decimal"
										aria-label="{c.crop} yield, quintals per hectare"
										placeholder={c.market.yield ? String(c.market.yield.value) : 'yield'}
										value={c.manualYield ? c.yieldQha : ''}
										onchange={(e) => {
											const v = parseFloat(e.currentTarget.value);
											market.setYield(c.crop, Number.isFinite(v) ? v : null);
										}}
									/>
									q/ha
								</label>
							{:else}
								? q/ha
							{/if}
							×
							{c.market?.price ? `₹${c.market.price.value.toLocaleString('en-IN')}/q` : '₹?/q'}
						</div>
						{#if c.market}
							<div class="crop-src">Price: {priceNote(c)}</div>
							<div class="crop-src">
								Yield: {c.manualYield
									? `your figure${c.market.yield ? `; default was ${yieldNote(c)}` : ''}`
									: c.market.yield
										? yieldNote(c)
										: 'none on file; type one to price this crop'}
							</div>
						{/if}
					</li>
				{/each}
			</ul>
			<p class="muted note">
				Yields are editable: type quintals per hectare (kapas for cotton, paddy for rice) to use your own figure. It is
				kept in this browser.
				{#if Object.keys(market.manualYields).length}
					<button type="button" class="link" onclick={() => market.clearYields()}>Clear my yields</button>
				{/if}
			</p>
			{#if unmatched.length}
				<p class="muted note">Not priced (no Agmarknet commodity mapped): {unmatched.map((c) => c.crop).join(', ')}.</p>
			{/if}
		</section>

		{#if seasonColumns.columns.length}
			<section>
				<h3>Every season</h3>
				<p class="muted">
					Region revenue by crop if each season sold at today's mandi prices and these yields. K Kharif, R Rabi, S
					Summer. Click a column to show that season on the map.
				</p>
				<TLabSeasonChart
					columns={seasonColumns.columns}
					selected={market.seasonKey}
					onSelect={onSeason}
					format={(v) => `₹${compactRupees(v)}`}
					legend={seasonColumns.legend}
					label="Revenue by season"
				/>
			</section>
		{/if}

		<section>
			<h3>Sources</h3>
			<p class="muted">
				Prices: Agmarknet modal prices via data.gov.in, median of the last {data.windowDays} days, from mandis in
				{data.districts.filter((d) => d.state === data.state).map((d) => d.district).join(', ')}, else {data.state}, else
				India.
			</p>
			<p class="muted">Yields: {data.yieldSource ?? 'not built yet (scripts/build_crop_yields.py)'}.</p>
			{#if coverage}
				<p class="muted">
					Mandi reports on hand: {coverage.days} of the last {coverage.windowDays} days{#if coverage.from}
						({day(coverage.from)}–{day(coverage.to!)}){/if}{coverage.partialDays ? `, ${coverage.partialDays} more in part` : ''}.
				</p>
				{#if filling}
					<p class="warn">
						Still copying mandi reports from data.gov.in{coverage.collecting ? ' (running now)' : ''}; prices firm up as
						more days arrive.{#if coverage.lastError}
							Last error: {coverage.lastError}.{/if}
					</p>
				{/if}
			{/if}
			{#if data.sampleKey}
				<p class="warn">Using data.gov.in's sample key (10 rows per request), so prices rest on few reports.</p>
			{/if}
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

	.muted {
		margin: 0 0 0.5rem;
		font-size: 0.72rem;
		color: #00296b99;
	}

	.note {
		margin: 0.7rem 0 0;
	}

	.warn {
		margin: 0 0 0.5rem;
		font-size: 0.72rem;
		color: #b45309;
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

	.cell {
		background: #fefce8;
	}

	.cell-total {
		margin: 0 0 0.4rem;
		font-size: 1.1rem;
		font-weight: 700;
	}

	.crops {
		list-style: none;
		margin: 0;
		padding: 0;
		font-size: 0.74rem;
	}

	.n {
		margin-left: auto;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.crops li {
		padding: 0.45rem 0;
		border-bottom: 1px solid #00296b0d;
	}

	.crops li.unpriced {
		opacity: 0.6;
	}

	.crop-head {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		font-size: 0.8rem;
	}

	.crop-head .n {
		font-weight: 700;
	}

	.crop-line {
		margin-top: 0.1rem;
		font-variant-numeric: tabular-nums;
	}

	.yield-input {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
	}

	.yield-input input {
		width: 4.2rem;
		padding: 0.1rem 0.3rem;
		border: 1px solid color-mix(in srgb, #00296b 25%, white);
		border-radius: 0.3rem;
		font: inherit;
		font-size: 0.74rem;
		color: #00296b;
		font-variant-numeric: tabular-nums;
	}

	.yield-input input::placeholder {
		color: #00296b88;
	}

	.yield-input.manual input {
		border-color: #ca8a04;
		background: #fefce8;
		font-weight: 700;
	}

	.crop-src {
		font-size: 0.66rem;
		color: #00296b99;
	}

	.method {
		margin: 0.4rem 0 0.6rem;
		padding: 0.55rem 0.7rem;
		border-radius: 0.4rem;
		background: #f8fafc;
		font-size: 0.7rem;
		line-height: 1.45;
		color: #00296bcc;
	}

	.method.top {
		margin: 0;
	}

	.formula {
		margin: 0.3rem 0 0;
		padding: 0.3rem 0.5rem;
		border-radius: 0.3rem;
		background: white;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.68rem;
		color: #00296b;
	}

	.pick {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin-top: 0.45rem;
		font-size: 0.68rem;
	}

	.pick select {
		font: inherit;
		padding: 0.1rem 0.3rem;
	}

	.work {
		width: 100%;
		margin-top: 0.3rem;
		border-collapse: collapse;
		font-size: 0.66rem;
		font-variant-numeric: tabular-nums;
		background: white;
	}

	.work th,
	.work td {
		padding: 0.15rem 0.4rem;
		border-bottom: 1px solid #00296b0d;
		text-align: left;
	}

	.work th {
		font-weight: 600;
		color: #00296b99;
	}

	.work .num {
		text-align: right;
	}

	.fine {
		margin: 0.35rem 0 0;
		font-size: 0.66rem;
		color: #00296b99;
	}

	.link {
		border: 0;
		background: none;
		padding: 0;
		font: inherit;
		font-size: 0.75rem;
		font-weight: 600;
		color: #1b75e0;
		cursor: pointer;
	}
</style>
