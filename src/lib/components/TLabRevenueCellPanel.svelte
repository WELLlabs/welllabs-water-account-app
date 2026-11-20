<script lang="ts">
	import type { ViewMode } from '$lib/groupUtils';
	import { fmt, fmtAcres } from '$lib/components/cropcalc/format';
	import { seasonParts, type TLabWater } from '$lib/tlabWater.svelte';
	import {
		REVENUE_EMPTY,
		REVENUE_PALETTE,
		compactRupees,
		formatRupees,
		type MarketLevel,
		type TLabMarket
	} from '$lib/tlabMarket.svelte';
	import { downloadBlob } from '$lib/exportUtils';

	interface Props {
		market: TLabMarket;
		/** Holds the clicked cell's plots and the shared view and selection (same as the water budget) */
		water: TLabWater;
		cellToken: string | null;
		onClose: () => void;
		onZoomPlot: (id: string) => void;
		onZoomCrop: (crop: string) => void;
	}

	let { market, water, cellToken, onClose, onZoomPlot, onZoomCrop }: Props = $props();

	const HA_PER_ACRE = 0.40468564224;
	const PLOT_PAGE = 150;
	let plotLimit = $state(PLOT_PAGE);

	const season = $derived(seasonParts(water.seasonKey));
	const plots = $derived(market.plotRevenue(water.plots));
	const byId = $derived(new Map(water.plots.map((p) => [p.id, p])));

	interface CropRow {
		crop: string;
		plots: number;
		acres: number;
		revenue: number;
		yieldQha: number | null;
		manualYield: boolean;
		price: number | null;
		priced: boolean;
	}

	const rows = $derived.by((): CropRow[] => {
		const m = new Map<string, CropRow>();
		for (const p of plots) {
			let r = m.get(p.crop);
			if (!r) {
				const mk = market.data?.crops[p.crop];
				r = {
					crop: p.crop,
					plots: 0,
					acres: 0,
					revenue: 0,
					yieldQha: market.yieldOf(p.crop),
					manualYield: p.crop in market.manualYields,
					price: mk?.price?.value ?? null,
					priced: market.rates.has(p.crop)
				};
				m.set(p.crop, r);
			}
			r.plots++;
			r.acres += p.acres;
			r.revenue += p.revenue;
		}
		return [...m.values()].sort((a, b) => b.revenue - a.revenue || b.acres - a.acres);
	});

	const totals = $derived.by(() => {
		let revenue = 0;
		let acres = 0;
		let pricedAcres = 0;
		for (const r of rows) {
			revenue += r.revenue;
			acres += r.acres;
			if (r.priced) pricedAcres += r.acres;
		}
		return { revenue, acres, pricedAcres, plots: plots.length };
	});

	const cropRow = $derived(water.selectedCrop ? (rows.find((r) => r.crop === water.selectedCrop) ?? null) : null);
	const plot = $derived(water.selectedPlot ? (plots.find((p) => p.id === water.selectedPlot) ?? null) : null);
	const plotFeature = $derived(plot ? byId.get(plot.id)?.feature : null);
	const maxCrop = $derived(Math.max(1, ...rows.map((r) => r.revenue)));
	const unpriced = $derived(rows.filter((r) => !r.priced));

	const LEVEL: Record<MarketLevel, string> = { district: 'district', state: 'state', india: 'India' };

	function priceSource(crop: string): string {
		const p = market.data?.crops[crop]?.price;
		if (!p) return 'no mandi price in the last 30 days';
		return `${LEVEL[p.level]} median (${p.place}), ${fmt(p.reports)} mandi reports`;
	}

	function yieldSource(crop: string): string {
		if (crop in market.manualYields) return 'your figure';
		const y = market.data?.crops[crop]?.yield;
		if (!y) return 'none on file';
		return `DES ${LEVEL[y.level]} median (${y.place})`;
	}

	function setView(mode: ViewMode) {
		water.viewMode = mode;
		if (mode !== 'plot') water.selectedPlot = null;
		if (mode !== 'group') water.selectedCrop = null;
	}

	function pickCrop(crop: string) {
		water.selectedCrop = water.selectedCrop === crop ? null : crop;
		if (water.selectedCrop) onZoomCrop(crop);
	}

	function pickPlot(id: string) {
		water.selectedPlot = id;
		onZoomPlot(id);
	}

	function perAcre(revenue: number, acres: number): string {
		return acres > 0 ? formatRupees(revenue / acres) : '—';
	}

	function exportCsv(kind: 'crops' | 'plots') {
		const name = `${market.exportName}_cell_${cellToken ?? water.cellId}_revenue_${kind}_${water.seasonKey.replace(/[^\w]+/g, '_').toLowerCase()}.csv`;
		const lines =
			kind === 'crops'
				? [
						'crop,plots,acres,yield_q_per_ha,price_inr_per_q,revenue_inr',
						...rows.map((r) => `${r.crop},${r.plots},${r.acres.toFixed(3)},${r.yieldQha ?? ''},${r.price ?? ''},${Math.round(r.revenue)}`)
					]
				: ['plot_id,crop,acres,revenue_inr', ...plots.map((p) => `${p.id},${p.crop},${p.acres.toFixed(3)},${Math.round(p.revenue)}`)];
		downloadBlob(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }), name);
	}
</script>

<aside class="panel" aria-label="Market revenue for the selected cell">
	<header>
		<div class="title">
			<span class="sw" style:background="linear-gradient(135deg, {REVENUE_PALETTE[1]}, {REVENUE_PALETTE[4]})"></span>
			<div>
				<h2>Market revenue</h2>
				<p class="meta">Cell {cellToken ?? water.cellId} · {water.seasonKey} <small>({season.range})</small></p>
			</div>
		</div>
		<button type="button" class="close" onclick={onClose} aria-label="Close cell revenue">×</button>
	</header>

	{#if water.cellLoading}
		<section><p class="muted">Loading this cell's farm plots…</p></section>
	{:else if water.cellError}
		<section><p class="err">{water.cellError}</p></section>
	{:else if market.status !== 'done'}
		<section><p class="muted">Waiting for mandi prices…</p></section>
	{:else if plots.length}
		<div class="tabs" role="tablist" aria-label="Revenue view">
			{#each [{ id: 'group', label: 'Crop level' }, { id: 'overall', label: 'Overall' }, { id: 'plot', label: 'Individual plots' }] as tab}
				<button
					type="button"
					role="tab"
					aria-selected={water.viewMode === tab.id}
					class:on={water.viewMode === tab.id}
					onclick={() => setView(tab.id as ViewMode)}>{tab.label}</button
				>
			{/each}
		</div>

		{#if water.viewMode === 'overall'}
			<section>
				<dl class="facts">
					<div class="wide">
						<dt>Gross crop revenue</dt>
						<dd class="big">{formatRupees(totals.revenue)}</dd>
					</div>
					<div><dt>Farm plots</dt><dd>{fmt(totals.plots)}</dd></div>
					<div><dt>Farm area</dt><dd>{fmtAcres(totals.acres)} <small class="inline">ac</small></dd></div>
					<div><dt>Priced area</dt><dd>{fmtAcres(totals.pricedAcres)} <small class="inline">ac</small></dd></div>
					<div><dt>Per priced acre</dt><dd>{perAcre(totals.revenue, totals.pricedAcres)}</dd></div>
				</dl>
				<h3>By crop</h3>
				<ul class="hbars">
					{#each rows.filter((r) => r.revenue > 0) as r (r.crop)}
						<li>
							<span class="hb-label"><span class="sw sm" style:background={water.cropColors.get(r.crop) ?? REVENUE_EMPTY}></span>{r.crop}</span>
							<span class="hb-track"><span class="hb-fill" style:width="{(r.revenue / maxCrop) * 100}%" style:background={REVENUE_PALETTE[3]}></span></span>
							<span class="hb-val">{formatRupees(r.revenue)}</span>
						</li>
					{/each}
				</ul>
				{#if unpriced.length}
					<p class="note">
						Not in the total: {unpriced.map((r) => `${r.crop} (${fmtAcres(r.acres)} ac)`).join(', ')}, with no mandi price or
						yield.
					</p>
				{/if}
			</section>
		{:else if water.viewMode === 'group' && cropRow}
			{@const color = water.cropColors.get(cropRow.crop) ?? REVENUE_EMPTY}
			<section>
				<button type="button" class="link" onclick={() => (water.selectedCrop = null)}>‹ All crops</button>
				<h3 class="group-title"><span class="sw sm" style:background={color}></span>{cropRow.crop}</h3>
				<dl class="facts mt">
					<div class="wide">
						<dt>Gross revenue</dt>
						<dd class="big">{cropRow.priced ? formatRupees(cropRow.revenue) : '—'}</dd>
					</div>
					<div><dt>Farm plots</dt><dd>{fmt(cropRow.plots)}</dd></div>
					<div><dt>Farm area</dt><dd>{fmtAcres(cropRow.acres)} <small class="inline">ac</small></dd></div>
					<div>
						<dt>Yield</dt>
						<dd>{cropRow.yieldQha ?? '—'} <small class="inline">q/ha</small><small>{yieldSource(cropRow.crop)}</small></dd>
					</div>
					<div>
						<dt>Mandi price</dt>
						<dd>{cropRow.price ? `₹${fmt(cropRow.price)}` : '—'} <small class="inline">/q</small><small>{priceSource(cropRow.crop)}</small></dd>
					</div>
					<div><dt>Per acre</dt><dd>{cropRow.priced ? perAcre(cropRow.revenue, cropRow.acres) : '—'}</dd></div>
					<div>
						<dt>Expected produce</dt>
						<dd>{cropRow.yieldQha ? fmt(cropRow.yieldQha * cropRow.acres * HA_PER_ACRE) : '—'} <small class="inline">q</small></dd>
					</div>
					<div>
						<dt>Share of cell revenue</dt>
						<dd>{cropRow.priced && totals.revenue > 0 ? `${((cropRow.revenue / totals.revenue) * 100).toFixed(1)}%` : '—'}</dd>
					</div>
					<div>
						<dt>Share of farm area</dt>
						<dd>{totals.acres > 0 ? `${((cropRow.acres / totals.acres) * 100).toFixed(1)}%` : '—'}</dd>
					</div>
				</dl>
				{#if !cropRow.priced}
					<p class="note">No mandi price or yield for {cropRow.crop.toLowerCase()}, so it isn't in the cell total.</p>
				{/if}
			</section>
		{:else if water.viewMode === 'group'}
			<section>
				<p class="muted">Click a crop here or a plot on the map for details on that crop group.</p>
				<table class="crops">
					<thead>
						<tr><th>Crop</th><th class="num">Plots</th><th class="num">Acres</th><th class="num">₹</th></tr>
					</thead>
					<tbody>
						{#each rows as r (r.crop)}
							<tr class:sel={water.selectedCrop === r.crop} onclick={() => pickCrop(r.crop)}>
								<td><span class="sw sm" style:background={water.cropColors.get(r.crop) ?? REVENUE_EMPTY}></span>{r.crop}</td>
								<td class="num">{fmt(r.plots)}</td>
								<td class="num">{fmtAcres(r.acres)}</td>
								<td class="num">{r.priced ? compactRupees(r.revenue) : 'no price'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</section>
		{:else if plot}
			<section>
				<button type="button" class="link" onclick={() => (water.selectedPlot = null)}>‹ All plots</button>
				<dl class="facts mt">
					<div class="wide">
						<dt>Crop</dt>
						<dd>
							<span class="sw sm" style:background={water.cropColors.get(plot.crop) ?? REVENUE_EMPTY}></span>{plot.crop}
							{#if plotFeature?.properties.second_crop}
								<small>Next most likely: {plotFeature.properties.second_crop}</small>
							{/if}
						</dd>
					</div>
					<div class="wide">
						<dt>Gross revenue</dt>
						<dd class="big">{plot.priced ? formatRupees(plot.revenue) : '—'}</dd>
					</div>
					<div><dt>Area</dt><dd>{plot.acres.toFixed(2)} <small class="inline">ac</small></dd></div>
					<div>
						<dt>Confidence</dt>
						<dd>{plotFeature ? `${Math.round(Number(plotFeature.properties.confidence) * 100)}%` : '—'}</dd>
					</div>
					<div>
						<dt>Yield</dt>
						<dd>{market.yieldOf(plot.crop) ?? '—'} <small class="inline">q/ha</small><small>{yieldSource(plot.crop)}</small></dd>
					</div>
					<div>
						<dt>Mandi price</dt>
						<dd>
							{market.data?.crops[plot.crop]?.price ? `₹${fmt(market.data.crops[plot.crop].price!.value)}` : '—'}
							<small class="inline">/q</small><small>{priceSource(plot.crop)}</small>
						</dd>
					</div>
					<div class="wide"><dt>Plot ID</dt><dd class="code">{plot.id}</dd></div>
				</dl>
				{#if !plot.priced}
					<p class="note">No mandi price or yield for {plot.crop.toLowerCase()}, so this plot isn't in the total.</p>
				{/if}
			</section>
		{:else}
			<section>
				<p class="muted">{fmt(plots.length)} plots, highest revenue first. Map colours run light to dark gold by revenue.</p>
				<ol class="plots">
					{#each plots.slice(0, plotLimit) as p (p.id)}
						<li>
							<button type="button" onclick={() => pickPlot(p.id)}>
								<span class="sw sm" style:background={water.cropColors.get(p.crop) ?? REVENUE_EMPTY}></span>
								<span class="pc">{p.crop}</span>
								<span class="pa">{p.acres.toFixed(2)} ac</span>
								<span class="pm">{p.priced ? formatRupees(p.revenue) : '—'}</span>
							</button>
						</li>
					{/each}
				</ol>
				{#if plots.length > plotLimit}
					<button type="button" class="link mt" onclick={() => (plotLimit += PLOT_PAGE * 2)}>
						Show more ({fmt(plots.length - plotLimit)} left)
					</button>
				{/if}
			</section>
		{/if}

		<section>
			<h3>Export this cell</h3>
			<div class="exports">
				<button type="button" onclick={() => exportCsv('crops')}>Crop summary CSV</button>
				<button type="button" onclick={() => exportCsv('plots')}>Plots CSV</button>
			</div>
		</section>
	{:else}
		<section><p class="muted">No farm plots in this cell.</p></section>
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
		margin: 0.9rem 0 0.4rem;
		font-size: 0.85rem;
		font-weight: 700;
	}

	.meta {
		margin: 0.15rem 0 0;
		font-size: 0.75rem;
		color: #00296bcc;
	}

	.meta small {
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

	.tabs {
		display: flex;
		gap: 0.3rem;
		padding: 0.7rem 1rem 0;
	}

	.tabs button {
		flex: 1;
		padding: 0.4rem 0.3rem;
		border: none;
		border-radius: 0.4rem;
		background: #f1f5f9;
		color: #00296bcc;
		font: inherit;
		font-size: 0.74rem;
		font-weight: 600;
		cursor: pointer;
	}

	.tabs button.on {
		background: #ca8a04;
		color: white;
	}

	.sw {
		display: inline-block;
		width: 0.9rem;
		height: 0.9rem;
		border-radius: 0.2rem;
		margin-top: 0.25rem;
		flex-shrink: 0;
	}

	.sw.sm {
		width: 0.65rem;
		height: 0.65rem;
		margin: 0 0.35rem 0 0;
		vertical-align: baseline;
	}

	.muted {
		margin: 0 0 0.5rem;
		font-size: 0.72rem;
		color: #00296b99;
	}

	.err {
		margin: 0.4rem 0 0;
		font-size: 0.78rem;
		color: #b91c1c;
	}

	.note {
		margin: 0.8rem 0 0;
		padding: 0.45rem 0.6rem;
		border-radius: 0.4rem;
		background: #fffbeb;
		color: #92400e;
		font-size: 0.72rem;
		line-height: 1.45;
	}

	.mt {
		margin-top: 0.6rem;
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

	dd.code {
		font-size: 0.72rem;
		font-weight: 500;
		word-break: break-all;
	}

	dd small {
		display: block;
		font-size: 0.66rem;
		font-weight: 400;
		color: #00296b99;
	}

	dd small.inline {
		display: inline;
	}

	.hbars {
		list-style: none;
		margin: 0;
		padding: 0;
		font-size: 0.74rem;
	}

	.hbars li {
		display: grid;
		grid-template-columns: 6.5rem 1fr auto;
		align-items: center;
		gap: 0.5rem;
		padding: 0.2rem 0;
	}

	.hb-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.hb-track {
		height: 0.55rem;
		border-radius: 999px;
		background: #f1f5f9;
		overflow: hidden;
	}

	.hb-fill {
		display: block;
		height: 100%;
		border-radius: 999px;
	}

	.hb-val {
		font-weight: 600;
		font-variant-numeric: tabular-nums;
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
		padding: 0.35rem 0.3rem 0.35rem 0;
		border-bottom: 1px solid #00296b0d;
	}

	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.group-title {
		display: flex;
		align-items: center;
		font-size: 1rem;
	}

	.crops tbody tr {
		cursor: pointer;
	}

	.crops tbody tr:hover,
	.crops tbody tr.sel {
		background: color-mix(in srgb, #ca8a04 10%, white);
	}

	.crops tbody tr.sel td:first-child {
		font-weight: 700;
	}

	.plots {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.plots button {
		display: flex;
		align-items: center;
		gap: 0.2rem;
		width: 100%;
		padding: 0.35rem 0.2rem;
		border: none;
		border-bottom: 1px solid #00296b0d;
		background: none;
		font: inherit;
		font-size: 0.74rem;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}

	.plots button:hover {
		background: color-mix(in srgb, #ca8a04 10%, white);
	}

	.pc {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.pa {
		width: 4.2rem;
		text-align: right;
		color: #00296b99;
	}

	.pm {
		width: 5.6rem;
		text-align: right;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.link {
		padding: 0;
		border: none;
		background: none;
		font: inherit;
		font-size: 0.76rem;
		font-weight: 600;
		color: #1b75e0;
		cursor: pointer;
	}

	.link:hover {
		text-decoration: underline;
	}

	.exports {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.4rem;
		margin-top: 0.4rem;
	}

	.exports button {
		padding: 0.4rem 0.5rem;
		border: 1px solid color-mix(in srgb, #ca8a04 50%, white);
		border-radius: 0.4rem;
		background: #fefce8;
		color: #854d0e;
		font: inherit;
		font-size: 0.72rem;
		font-weight: 600;
		cursor: pointer;
	}

	@media (max-width: 768px) {
		.panel {
			width: 100%;
			border-left: none;
			border-top: 1px solid color-mix(in srgb, #00296b 12%, white);
		}
	}
</style>
