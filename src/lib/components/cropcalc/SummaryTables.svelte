<script lang="ts">
	import { formatCalendarMonth } from '$lib/waterBudget';
	import type { CropSummaryRow, MonthKey, SummaryTotals } from '$lib/regionBudget';
	import { fmt, fmtAcres } from './format';

	interface Props {
		summary: { rows: CropSummaryRow[]; months: MonthKey[] };
		totals: SummaryTotals;
		title: string;
		cropColors: Map<string, string>;
	}

	let { summary, totals, title, cropColors }: Props = $props();

	const matchedRows = $derived(summary.rows.filter((r) => r.matched));
	const peakMonthM3 = $derived(Math.max(0, ...totals.monthTotals.map((m) => m.m3)));
</script>

<section class="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
	<div class="border-b border-slate-100 px-5 py-3">
		<h3 class="text-sm font-semibold text-slate-800">Crop-level requirement · {title}</h3>
	</div>
	<div class="overflow-x-auto">
		<table class="w-full text-xs">
			<thead>
				<tr class="border-b border-slate-100 bg-slate-50 text-slate-600">
					<th class="px-4 py-2.5 text-left font-semibold">Crop</th>
					<th class="px-3 py-2.5 text-right font-semibold">Plots</th>
					<th class="px-3 py-2.5 text-right font-semibold">Acres</th>
					<th class="px-3 py-2.5 text-right font-semibold">m³ / acre</th>
					<th class="px-3 py-2.5 text-right font-semibold">Season total (m³)</th>
					<th class="px-4 py-2.5 text-left font-semibold">Share</th>
				</tr>
			</thead>
			<tbody>
				{#each summary.rows as r}
					{@const share = totals.m3 > 0 ? (r.totalM3 / totals.m3) * 100 : 0}
					<tr class="border-b border-slate-50 {r.matched ? '' : 'text-slate-400'}">
						<td class="px-4 py-2.5 font-medium {r.matched ? 'text-slate-800' : ''}">
							<span
								class="mr-2 inline-block h-2.5 w-2.5 rounded-sm border border-slate-300 align-middle"
								style="background: {cropColors.get(r.crop) ?? '#94a3b8'}"
							></span>
							{r.crop}
						</td>
						<td class="px-3 py-2.5 text-right tabular-nums">{fmt(r.plots)}</td>
						<td class="px-3 py-2.5 text-right tabular-nums">{fmtAcres(r.acres)}</td>
						<td class="px-3 py-2.5 text-right tabular-nums">{r.matched ? fmt(r.m3PerAcre) : '—'}</td>
						<td class="px-3 py-2.5 text-right font-semibold tabular-nums {r.matched ? 'text-sky-700' : ''}">
							{r.matched ? fmt(r.totalM3) : 'no water budget'}
						</td>
						<td class="px-4 py-2.5">
							{#if r.matched}
								<div class="flex items-center gap-2">
									<div class="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
										<div class="h-full rounded-full bg-sky-500" style="width: {share.toFixed(1)}%"></div>
									</div>
									<span class="tabular-nums text-slate-500">{share.toFixed(1)}%</span>
								</div>
							{/if}
						</td>
					</tr>
				{/each}
				<tr class="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-800">
					<td class="px-4 py-3">Total</td>
					<td class="px-3 py-3 text-right tabular-nums">{fmt(totals.plots)}</td>
					<td class="px-3 py-3 text-right tabular-nums">{fmtAcres(totals.acres)}</td>
					<td class="px-3 py-3 text-right tabular-nums">
						{totals.matchedAcres > 0 ? fmt(totals.m3 / totals.matchedAcres) : '—'}
					</td>
					<td class="px-3 py-3 text-right tabular-nums text-sky-700">{fmt(totals.m3)}</td>
					<td></td>
				</tr>
			</tbody>
		</table>
	</div>
</section>

{#if summary.months.length}
	<section class="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
		<div class="border-b border-slate-100 px-5 py-3">
			<h3 class="text-sm font-semibold text-slate-800">Month-wise water requirement (m³)</h3>
		</div>
		<div class="overflow-x-auto">
			<table class="w-full text-xs">
				<thead>
					<tr class="border-b border-slate-100 bg-slate-50">
						<th class="sticky left-0 bg-slate-50 px-4 py-2.5 text-left font-semibold text-slate-600">Month</th>
						{#each matchedRows as r}
							<th class="px-3 py-2.5 text-right font-semibold text-slate-600">{r.crop}</th>
						{/each}
						<th class="px-4 py-2.5 text-right font-semibold text-slate-700">Total</th>
					</tr>
				</thead>
				<tbody>
					{#each totals.monthTotals as m}
						<tr class="border-b border-slate-50 hover:bg-slate-50/60">
							<td class="sticky left-0 bg-white px-4 py-2.5 font-medium text-slate-700">
								{formatCalendarMonth(m.calendarMonth, m.calendarYear)}
							</td>
							{#each matchedRows as r}
								{@const v = r.months.get(m.key) ?? 0}
								<td class="px-3 py-2.5 text-right tabular-nums text-slate-600">{v > 0 ? fmt(v) : '—'}</td>
							{/each}
							<td class="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-800">
								<div class="flex items-center justify-end gap-2">
									<div class="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
										<div
											class="h-full rounded-full bg-sky-500"
											style="width: {peakMonthM3 > 0 ? ((m.m3 / peakMonthM3) * 100).toFixed(1) : 0}%"
										></div>
									</div>
									{fmt(m.m3)}
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
{/if}
