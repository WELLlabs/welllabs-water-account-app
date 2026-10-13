<script lang="ts">
	import { formatCalendarMonth } from '$lib/waterBudget';
	import { NO_PREDICTION, UNCERTAIN, type SummaryTotals } from '$lib/regionBudget';
	import { fmt, fmtAcres } from './format';

	let { totals, seasonKey }: { totals: SummaryTotals; seasonKey: string } = $props();
</script>

<div class="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
	<div class="rounded-xl border border-slate-200 bg-white px-4 py-3">
		<div class="text-xs font-medium text-slate-500">Total water need</div>
		<div class="mt-1 text-xl font-bold text-sky-700">{fmt(totals.m3)} m³</div>
		<div class="text-xs text-slate-400">{(totals.m3 / 1e6).toFixed(2)} million m³ · {seasonKey}</div>
	</div>
	<div class="rounded-xl border border-slate-200 bg-white px-4 py-3">
		<div class="text-xs font-medium text-slate-500">Area with a water budget</div>
		<div class="mt-1 text-xl font-bold text-slate-800">{fmtAcres(totals.matchedAcres)} ac</div>
		<div class="text-xs text-slate-400">of {fmtAcres(totals.acres)} ac of farm plots</div>
	</div>
	<div class="rounded-xl border border-slate-200 bg-white px-4 py-3">
		<div class="text-xs font-medium text-slate-500">Plots</div>
		<div class="mt-1 text-xl font-bold text-slate-800">{fmt(totals.plots)}</div>
		<div class="text-xs text-slate-400">{fmt(totals.matchedPlots)} with a budgeted crop</div>
	</div>
	<div class="rounded-xl border border-slate-200 bg-white px-4 py-3">
		<div class="text-xs font-medium text-slate-500">Peak month</div>
		<div class="mt-1 text-xl font-bold text-slate-800">
			{totals.peak ? formatCalendarMonth(totals.peak.calendarMonth, totals.peak.calendarYear) : '—'}
		</div>
		<div class="text-xs text-slate-400">{totals.peak ? `${fmt(totals.peak.m3)} m³` : 'no budgeted crops'}</div>
	</div>
</div>

{#if totals.unmatched.length}
	<div class="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
		<span class="font-semibold text-slate-700">Not in the total:</span>
		{#each totals.unmatched as r, i}
			{i ? ' · ' : ' '}{r.crop} ({fmt(r.plots)} plots, {fmtAcres(r.acres)} ac)
		{/each}.
		<span class="text-slate-400">
			{#if totals.unmatched.some((r) => r.crop !== NO_PREDICTION && r.crop !== UNCERTAIN && r.crop !== 'Unknown')}
				Add these crops to <code>total_water_needed.csv</code> to include them.
			{:else}
				These plots have no confident crop for this season.
			{/if}
		</span>
	</div>
{/if}
