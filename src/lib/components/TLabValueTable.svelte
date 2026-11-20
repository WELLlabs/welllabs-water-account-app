<script lang="ts">
	import { cropColor } from '$lib/tlab';
	import { compactRupees } from '$lib/tlabMarket.svelte';
	import { rupeesPerM3, type ValueRow } from '$lib/tlabSeries';
	import { compactM3 } from '$lib/tlabWater.svelte';

	interface Props {
		rows: ValueRow[];
		/** e.g. "2020–21 to 2024–25" */
		span: string;
	}

	let { rows, span }: Props = $props();

	const best = $derived(rows[0] ?? null);
	const worst = $derived(rows.length > 1 ? rows[rows.length - 1] : null);
</script>

{#if best}
	<p class="insight">
		<strong>{best.crop}</strong> earns the most for its water: {rupeesPerM3(best.perM3)} per m³{span ? ` over ${span}` : ''}{worst &&
		worst.perM3 > 0
			? `, ${(best.perM3 / worst.perM3).toFixed(1)}× ${worst.crop}, fifth on the list`
			: ''}.
	</p>
	<table>
		<thead>
			<tr><th>Crop</th><th class="num">₹ per m³</th><th class="num">Revenue</th><th class="num">Water</th><th class="num">₹ per ha</th></tr>
		</thead>
		<tbody>
			{#each rows as r (r.crop)}
				<tr>
					<td><span class="chip" style:background={cropColor(r.crop)}></span>{r.crop}</td>
					<td class="num strong">{rupeesPerM3(r.perM3)}</td>
					<td class="num">₹{compactRupees(r.revenue)}</td>
					<td class="num">{compactM3(r.m3)} m³</td>
					<td class="num">₹{compactRupees(r.perHa)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}

<style>
	.insight {
		margin: 0 0 0.4rem;
		font-size: 0.72rem;
		line-height: 1.45;
		color: #00296b;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.72rem;
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

	.strong {
		font-weight: 700;
	}

	.chip {
		display: inline-block;
		width: 0.6rem;
		height: 0.6rem;
		margin-right: 0.35rem;
		border-radius: 0.15rem;
		vertical-align: -1px;
	}
</style>
