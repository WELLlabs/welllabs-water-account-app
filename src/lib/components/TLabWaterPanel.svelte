<script lang="ts">
	import { downloadCsv } from '$lib/csvExporter';
	import { downloadPdf } from '$lib/pdfExporter';
	import { downloadCropSummaryCsv } from '$lib/regionBudget';
	import { formatCalendarMonth } from '$lib/waterBudget';
	import type { ViewMode } from '$lib/groupUtils';
	import { WATER_EMPTY, WATER_PALETTE, compactM3, seasonParts, type TLabWater } from '$lib/tlabWater.svelte';
	import { fmt, fmtAcres } from '$lib/components/cropcalc/format';

	interface Props {
		water: TLabWater;
		cellToken: string | null;
		onClose: () => void;
		onZoomPlot: (id: string) => void;
		onZoomCrop: (crop: string) => void;
	}

	let { water, cellToken, onClose, onZoomPlot, onZoomCrop }: Props = $props();

	const PLOT_PAGE = 150;
	/** One PDF page per plot; beyond this the plot PDF is impractically long */
	const MAX_PLOT_PDF = 200;

	let plotLimit = $state(PLOT_PAGE);
	let exporting = $state(false);
	let exportError = $state<string | null>(null);

	const totals = $derived(water.cellTotals);
	const summary = $derived(water.cellSummary);
	const season = $derived(seasonParts(water.seasonKey));
	const plot = $derived(water.selectedPlot ? (water.plots.find((p) => p.id === water.selectedPlot) ?? null) : null);
	const cropRow = $derived(water.selectedCrop ? (summary?.rows.find((r) => r.crop === water.selectedCrop) ?? null) : null);
	const exportName = $derived(`raichur_cell_${cellToken ?? water.cellId}_${water.seasonKey.replace(/[^\w]+/g, '_')}`);

	const noBudgetNote = $derived.by(() => {
		const rows = totals?.unmatched ?? [];
		const none = rows.filter((r) => r.crop === 'No prediction');
		const other = rows.filter((r) => r.crop !== 'No prediction');
		const parts: string[] = [];
		const cropAcres = other.reduce((s, r) => s + r.acres, 0);
		const noneAcres = none.reduce((s, r) => s + r.acres, 0);
		if (cropAcres > 0) parts.push(`${fmtAcres(cropAcres)} ac of crops without a water budget (${other.map((r) => r.crop).join(', ')})`);
		if (noneAcres > 0) parts.push(`${fmtAcres(noneAcres)} ac with no crop detected this season`);
		return parts.length ? `Not in the total: ${parts.join(' and ')}.` : null;
	});

	type Bar = { label: string; m3: number };
	const overallBars = $derived<Bar[]>(
		(totals?.monthTotals ?? []).map((m) => ({ label: formatCalendarMonth(m.calendarMonth, m.calendarYear), m3: m.m3 }))
	);
	const cropBars = $derived<Bar[]>(
		cropRow && summary
			? summary.months.map((m) => ({
					label: formatCalendarMonth(m.calendarMonth, m.calendarYear),
					m3: cropRow.months.get(m.key) ?? 0
				}))
			: []
	);
	const cropPeak = $derived(cropBars.reduce<Bar | null>((best, b) => (b.m3 > (best?.m3 ?? 0) ? b : best), null));
	const plotBars = $derived<Bar[]>(
		plot?.months.map((m) => ({ label: formatCalendarMonth(m.calendarMonth, m.calendarYear), m3: m.waterM3 })) ?? []
	);

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

	async function run(task: () => void | Promise<void>) {
		exporting = true;
		exportError = null;
		try {
			await task();
		} catch (e) {
			exportError = e instanceof Error ? e.message : 'Export failed.';
		} finally {
			exporting = false;
		}
	}

	const pdfBlocked = $derived(water.viewMode === 'plot' && water.plots.length > MAX_PLOT_PDF);
</script>

{#snippet monthBars(bars: Bar[], color: string)}
	{@const max = Math.max(1, ...bars.map((b) => b.m3))}
	{#if bars.some((b) => b.m3 > 0)}
		<div class="bars" role="img" aria-label="Water need by month">
			{#each bars as b}
				<div class="bar-col" title="{b.label}: {fmt(b.m3)} m³">
					<div class="bar" style:height="{(b.m3 / max) * 100}%" style:background={color}></div>
					<span>{b.label.split(' ')[0]}</span>
				</div>
			{/each}
		</div>
	{/if}
{/snippet}

<aside class="panel" aria-label="Water budget for the selected cell">
	<header>
		<div class="title">
			<span class="sw" style:background="linear-gradient(135deg, {WATER_PALETTE[1]}, {WATER_PALETTE[4]})"></span>
			<div>
				<h2>Water budget</h2>
				<p class="meta">Cell {cellToken ?? water.cellId} · {water.seasonKey} <small>({season.range})</small></p>
			</div>
		</div>
		<button type="button" class="close" onclick={onClose} aria-label="Close water budget">×</button>
	</header>

	{#if water.cellLoading}
		<section><p class="muted">Loading this cell's farm plots…</p></section>
	{:else if water.cellError}
		<section><p class="err">{water.cellError}</p></section>
	{:else if totals && summary}
		<div class="tabs" role="tablist" aria-label="Water budget view">
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
						<dt>Water needed</dt>
						<dd class="big">{fmt(totals.m3)} <small class="inline">m³</small></dd>
					</div>
					<div><dt>Farm plots</dt><dd>{fmt(totals.plots)}</dd></div>
					<div><dt>Farm area</dt><dd>{fmtAcres(totals.acres)} <small class="inline">ac</small></dd></div>
					<div>
						<dt>Per budgeted acre</dt>
						<dd>{totals.matchedAcres > 0 ? fmt(totals.m3 / totals.matchedAcres) : '—'} <small class="inline">m³</small></dd>
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
				</dl>
				{@render monthBars(overallBars, WATER_PALETTE[3])}
				{#if noBudgetNote}
					<p class="note">{noBudgetNote}</p>
				{/if}
			</section>
		{:else if water.viewMode === 'group' && cropRow}
			{@const color = water.cropColors.get(cropRow.crop) ?? WATER_EMPTY}
			<section>
				<button type="button" class="link" onclick={() => (water.selectedCrop = null)}>‹ All crops</button>
				<h3 class="group-title"><span class="sw sm" style:background={color}></span>{cropRow.crop}</h3>
				<dl class="facts mt">
					<div class="wide">
						<dt>Water needed</dt>
						<dd class="big">
							{#if cropRow.matched}{fmt(cropRow.totalM3)} <small class="inline">m³</small>{:else}—{/if}
						</dd>
					</div>
					<div><dt>Farm plots</dt><dd>{fmt(cropRow.plots)}</dd></div>
					<div><dt>Farm area</dt><dd>{fmtAcres(cropRow.acres)} <small class="inline">ac</small></dd></div>
					<div>
						<dt>Per acre</dt>
						<dd>{cropRow.matched ? fmt(cropRow.m3PerAcre) : '—'} <small class="inline">m³</small></dd>
					</div>
					<div>
						<dt>Peak month</dt>
						<dd>
							{#if cropPeak}{cropPeak.label} <small>{fmt(cropPeak.m3)} m³</small>{:else}—{/if}
						</dd>
					</div>
					<div>
						<dt>Share of cell water</dt>
						<dd>{cropRow.matched && totals.m3 > 0 ? `${((cropRow.totalM3 / totals.m3) * 100).toFixed(1)}%` : '—'}</dd>
					</div>
					<div>
						<dt>Share of farm area</dt>
						<dd>{totals.acres > 0 ? `${((cropRow.acres / totals.acres) * 100).toFixed(1)}%` : '—'}</dd>
					</div>
				</dl>
				{#if cropRow.matched}
					{@render monthBars(cropBars, color === WATER_EMPTY ? WATER_PALETTE[3] : color)}
				{:else}
					<p class="note">No water budget for {cropRow.crop.toLowerCase()}, so it isn't in the cell total.</p>
				{/if}
			</section>
		{:else if water.viewMode === 'group'}
			<section>
				<p class="muted">Click a crop here or a plot on the map for details on that crop group.</p>
				<table class="crops">
					<thead>
						<tr><th>Crop</th><th class="num">Plots</th><th class="num">Acres</th><th class="num">m³</th></tr>
					</thead>
					<tbody>
						{#each summary.rows as row}
							<tr class:sel={water.selectedCrop === row.crop} onclick={() => pickCrop(row.crop)}>
								<td>
									<span class="sw sm" style:background={water.cropColors.get(row.crop) ?? WATER_EMPTY}></span>{row.crop}
								</td>
								<td class="num">{fmt(row.plots)}</td>
								<td class="num">{fmtAcres(row.acres)}</td>
								<td class="num">{row.matched ? compactM3(row.totalM3) : 'no budget'}</td>
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
							<span class="sw sm" style:background={water.cropColors.get(plot.crop) ?? WATER_EMPTY}></span>{plot.crop}
							{#if plot.feature.properties.second_crop}
								<small>Next most likely: {plot.feature.properties.second_crop}</small>
							{/if}
						</dd>
					</div>
					<div>
						<dt>Confidence</dt>
						<dd>{Math.round(Number(plot.feature.properties.confidence) * 100)}%</dd>
					</div>
					<div><dt>Area</dt><dd>{plot.acres.toFixed(2)} <small class="inline">ac</small></dd></div>
					<div><dt>Water needed</dt><dd>{fmt(plot.m3)} <small class="inline">m³</small></dd></div>
					<div><dt>Sowing month</dt><dd>{String(plot.feature.properties.sowingDate).slice(0, 7)}</dd></div>
					<div class="wide"><dt>Plot ID</dt><dd class="code">{plot.id}</dd></div>
				</dl>
				{#if plot.m3 > 0}
					{@render monthBars(plotBars, water.cropColors.get(plot.crop) ?? WATER_PALETTE[3])}
				{:else}
					<p class="note">No water budget for {plot.crop.toLowerCase()}, so this plot isn't in the total.</p>
				{/if}
			</section>
		{:else}
			<section>
				<p class="muted">
					{fmt(water.plots.length)} plots, largest water need first. Map colours run light to dark blue by water need.
				</p>
				<ol class="plots">
					{#each water.plots.slice(0, plotLimit) as p (p.id)}
						<li>
							<button type="button" onclick={() => pickPlot(p.id)}>
								<span class="sw sm" style:background={water.cropColors.get(p.crop) ?? WATER_EMPTY}></span>
								<span class="pc">{p.crop}</span>
								<span class="pa">{p.acres.toFixed(2)} ac</span>
								<span class="pm">{p.m3 > 0 ? `${fmt(p.m3)} m³` : '—'}</span>
							</button>
						</li>
					{/each}
				</ol>
				{#if water.plots.length > plotLimit}
					<button type="button" class="link mt" onclick={() => (plotLimit += PLOT_PAGE * 2)}>
						Show more ({fmt(water.plots.length - plotLimit)} left)
					</button>
				{/if}
			</section>
		{/if}

		{#if water.processed}
			{@const processed = water.processed}
			<section>
				<h3>Export this cell</h3>
				<div class="exports">
					<button type="button" disabled={exporting} onclick={() => run(() => downloadCropSummaryCsv(summary, exportName, water.seasonKey))}>
						Crop summary CSV
					</button>
					<button type="button" disabled={exporting} onclick={() => run(() => downloadCsv(processed, exportName))}>Plots CSV</button>
					<button
						type="button"
						disabled={exporting || pdfBlocked}
						title={pdfBlocked ? `Plot PDFs are one page per plot; switch to Overall or Crop level for ${fmt(water.plots.length)} plots` : ''}
						onclick={() => run(() => downloadPdf(processed, exportName, { viewMode: water.viewMode, groupByColumn: 'crop' }))}
					>
						{water.viewMode === 'plot' ? 'Plot' : water.viewMode === 'group' ? 'Crop level' : 'Overall'} PDF
					</button>
				</div>
				{#if exporting}<p class="muted mt">Preparing export…</p>{/if}
				{#if exportError}<p class="err">{exportError}</p>{/if}
			</section>
		{/if}
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
		margin: 0.9rem 0 0.2rem;
		font-size: 0.85rem;
		font-weight: 700;
	}

	section > h3:first-child {
		margin-top: 0;
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
		background: #1b75e0;
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
		font-size: 0.7rem;
		font-weight: 400;
		color: #00296b99;
	}

	dd small.inline {
		display: inline;
	}

	.bars {
		display: flex;
		align-items: flex-end;
		gap: 3px;
		height: 5.5rem;
		margin-top: 0.9rem;
		padding-bottom: 1rem;
	}

	.bar-col {
		position: relative;
		flex: 1;
		height: 100%;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
	}

	.bar {
		min-height: 1px;
		border-radius: 2px 2px 0 0;
	}

	.bar-col span {
		position: absolute;
		bottom: -1rem;
		left: 50%;
		translate: -50% 0;
		font-size: 0.58rem;
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
		background: color-mix(in srgb, #1b75e0 8%, white);
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
		background: color-mix(in srgb, #1b75e0 8%, white);
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
		border: 1px solid color-mix(in srgb, #1b75e0 50%, white);
		border-radius: 0.4rem;
		background: color-mix(in srgb, #1b75e0 6%, white);
		color: #1559b0;
		font: inherit;
		font-size: 0.72rem;
		font-weight: 600;
		cursor: pointer;
	}

	.exports button:disabled {
		opacity: 0.5;
		cursor: default;
	}

	@media (max-width: 768px) {
		.panel {
			width: 100%;
			border-left: none;
			border-top: 1px solid color-mix(in srgb, #00296b 12%, white);
		}
	}
</style>
