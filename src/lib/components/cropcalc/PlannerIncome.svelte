<script lang="ts" module>
	export interface IncomeCrop {
		id: string;
		name: string;
		color: string;
		acres: number;
		waterM3: number;
	}
</script>

<script lang="ts">
	import type { PlannerMarket } from '$lib/plannerMarket.svelte';

	interface Props {
		crops: IncomeCrop[];
		market: PlannerMarket;
	}

	let { crops, market }: Props = $props();

	const HA_PER_ACRE = 0.40468564224;

	/** Planner crop → mandi / yield crops it can be priced as; the first is the default */
	const MARKET_OPTIONS: Record<string, { key: string; label: string }[]> = {
		paddy: [{ key: 'Rice', label: 'Paddy' }],
		cotton: [{ key: 'Cotton', label: 'Cotton (kapas)' }],
		groundnut: [{ key: 'Groundnut', label: 'Groundnut' }],
		pulses: [
			{ key: 'Tur', label: 'Tur (red gram)' },
			{ key: 'Gram', label: 'Bengal gram' }
		],
		millets: [
			{ key: 'Sorghum', label: 'Jowar' },
			{ key: 'Ragi', label: 'Ragi' },
			{ key: 'Bajra', label: 'Bajra' }
		],
		sunflower: [{ key: 'Sunflower', label: 'Sunflower' }],
		seasame: [{ key: 'Sesame', label: 'Sesame' }],
		sesame: [{ key: 'Sesame', label: 'Sesame' }],
		chilli: [{ key: 'Chilli', label: 'Dry chilli' }]
	};

	const data = $derived(market.data);
	const overrides = $derived(market.overrides);
	const setOverride = (id: string, patch: Parameters<PlannerMarket['setOverride']>[1]) => market.setOverride(id, patch);

	function options(c: IncomeCrop) {
		return MARKET_OPTIONS[c.id] ?? MARKET_OPTIONS[c.name.toLowerCase()] ?? [{ key: c.name, label: c.name }];
	}

	function num(v: string): number | undefined {
		const n = Number.parseFloat(v);
		return Number.isFinite(n) && n > 0 ? n : undefined;
	}

	const LEVEL = { district: 'district', state: 'state', india: 'India' } as const;

	const rows = $derived(
		crops.map((c) => {
			const opts = options(c);
			const o = overrides[c.id] ?? {};
			const market = opts.find((x) => x.key === o.market) ?? opts[0];
			const m = data?.crops[market.key] ?? null;
			const defYield = m?.yield ? m.yield.value * HA_PER_ACRE : null;
			const defPrice = m?.price?.value ?? null;
			const yieldQac = o.yieldQac ?? defYield;
			const price = o.price ?? defPrice;
			const income = yieldQac && price ? c.acres * yieldQac * price : null;
			return { c, opts, market, m, defYield, defPrice, yieldQac, price, income, o };
		})
	);

	const totals = $derived.by(() => {
		let income = 0;
		let acres = 0;
		let water = 0;
		let unpriced = 0;
		for (const r of rows) {
			if (r.income == null) {
				unpriced++;
				continue;
			}
			income += r.income;
			acres += r.c.acres;
			water += r.c.waterM3;
		}
		return { income, acres, water, unpriced };
	});

	function rupees(v: number): string {
		if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
		if (v >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
		return `₹${Math.round(v).toLocaleString('en-IN')}`;
	}

	function yieldSource(r: (typeof rows)[number]): string {
		const y = r.m?.yield;
		if (!y) return 'no DES yield; type one';
		const yrs = (y.series ?? []).map((s) => s[0]);
		const span = yrs.length ? (yrs.length > 1 ? ` ${yrs[0]} to ${yrs[yrs.length - 1]}` : ` ${yrs[0]}`) : '';
		return `${y.place} ${LEVEL[y.level]} median${span}, ${y.value} q/ha`;
	}

	function priceSource(r: (typeof rows)[number]): string {
		const p = r.m?.price;
		if (!p) return 'no mandi report in 30 days; type one';
		return `${p.place} ${LEVEL[p.level]} median of ${p.reports} reports`;
	}
</script>

<div class="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
	<div class="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 px-5 py-3">
		<div>
			<h3 class="text-sm font-semibold text-slate-800">Income at mandi prices</h3>
			<p class="mt-0.5 text-xs text-slate-400">
				Income = acres × yield (q/acre) × mandi price (₹/q). Gross, before costs.
			</p>
		</div>
		{#if market.district}
			<span class="text-xs text-slate-500">Prices and yields for <strong class="text-slate-700">{market.district.name}, {market.district.state}</strong></span>
		{/if}
	</div>

	{#if market.status === 'idle'}
		<p class="px-5 py-4 text-xs text-slate-500">Pick a district at the top to price this crop mix.</p>
	{:else if market.status === 'loading'}
		<p class="px-5 py-4 text-xs text-slate-500">Loading mandi prices and yields for {market.district?.name}…</p>
	{:else if market.status === 'error'}
		<p class="px-5 py-4 text-xs text-red-600">
			{market.error}
			{#if market.district}<button class="ml-2 font-semibold underline" onclick={() => market.retry()}>Retry</button>{/if}
		</p>
	{:else if crops.length === 0}
		<p class="px-5 py-4 text-xs text-slate-500">Add a crop to see its income.</p>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full text-xs">
				<thead>
					<tr class="border-b border-slate-100 bg-slate-50 text-slate-600">
						<th class="px-4 py-2.5 text-left font-semibold">Crop</th>
						<th class="px-3 py-2.5 text-right font-semibold">Acres</th>
						<th class="px-3 py-2.5 text-right font-semibold">Yield (q/acre)</th>
						<th class="px-3 py-2.5 text-right font-semibold">Price (₹/q)</th>
						<th class="px-3 py-2.5 text-right font-semibold">Income</th>
						<th class="px-4 py-2.5 text-right font-semibold">₹ per acre</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as r (r.c.id)}
						<tr class="border-b border-slate-50 align-top">
							<td class="px-4 py-2.5">
								<div class="flex items-center gap-2 font-medium text-slate-800">
									<span class="h-2.5 w-2.5 rounded-full" style="background-color: {r.c.color}"></span>
									{r.c.name}
								</div>
								{#if r.opts.length > 1}
									<select
										value={r.market.key}
										onchange={(e) => setOverride(r.c.id, { market: e.currentTarget.value })}
										class="mt-1 rounded border border-slate-200 px-1 py-0.5 text-xs text-slate-600"
										aria-label="Price {r.c.name} as"
									>
										{#each r.opts as o (o.key)}<option value={o.key}>{o.label}</option>{/each}
									</select>
								{/if}
							</td>
							<td class="px-3 py-2.5 text-right tabular-nums text-slate-600">{r.c.acres.toFixed(1)}</td>
							<td class="px-3 py-2.5 text-right">
								<input
									type="number"
									min="0"
									step="0.1"
									value={r.yieldQac != null ? +r.yieldQac.toFixed(2) : ''}
									placeholder="q/acre"
									onchange={(e) => setOverride(r.c.id, { yieldQac: num(e.currentTarget.value) })}
									class="w-20 rounded-md border px-2 py-1 text-right tabular-nums {r.o.yieldQac != null
										? 'border-amber-400 bg-amber-50'
										: 'border-slate-300'}"
								/>
								<div class="mt-0.5 text-[10px] leading-tight text-slate-400">
									{r.o.yieldQac != null ? 'your figure' : yieldSource(r)}
								</div>
							</td>
							<td class="px-3 py-2.5 text-right">
								<input
									type="number"
									min="0"
									step="10"
									value={r.price != null ? Math.round(r.price) : ''}
									placeholder="₹/q"
									onchange={(e) => setOverride(r.c.id, { price: num(e.currentTarget.value) })}
									class="w-24 rounded-md border px-2 py-1 text-right tabular-nums {r.o.price != null
										? 'border-amber-400 bg-amber-50'
										: 'border-slate-300'}"
								/>
								<div class="mt-0.5 text-[10px] leading-tight text-slate-400">
									{r.o.price != null ? 'your figure' : priceSource(r)}
								</div>
							</td>
							<td class="px-3 py-2.5 text-right font-semibold tabular-nums text-emerald-700">
								{r.income != null ? rupees(r.income) : '—'}
							</td>
							<td class="px-4 py-2.5 text-right tabular-nums text-slate-600">
								{r.income != null && r.c.acres > 0 ? rupees(r.income / r.c.acres) : '—'}
							</td>
						</tr>
					{/each}
					<tr class="border-t-2 border-slate-200 bg-slate-50 font-semibold">
						<td class="px-4 py-3 text-slate-800">Total</td>
						<td class="px-3 py-3 text-right tabular-nums text-slate-700">{totals.acres.toFixed(1)}</td>
						<td colspan="2" class="px-3 py-3 text-right text-[11px] font-normal text-slate-500">
							{totals.water > 0 ? `${rupees(totals.income / totals.water)} per m³ of water` : ''}
						</td>
						<td class="px-3 py-3 text-right tabular-nums text-emerald-700">{rupees(totals.income)}</td>
						<td class="px-4 py-3 text-right tabular-nums text-slate-700">
							{totals.acres > 0 ? rupees(totals.income / totals.acres) : '—'}
						</td>
					</tr>
				</tbody>
			</table>
		</div>
		<div class="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-[11px] text-slate-400">
			<span>
				Price: median Agmarknet modal price of the last {data?.windowDays ?? 30} days, district else state else India.
				Yield: DES median over recent years (kapas for cotton, paddy for rice). Edit either to use your own figure.
				{#if totals.unpriced}<strong class="text-amber-600">{totals.unpriced} crop{totals.unpriced > 1 ? 's' : ''} without a price or yield.</strong>{/if}
			</span>
			{#if Object.keys(overrides).length}
				<button
					class="font-semibold text-blue-600 hover:underline"
					onclick={() => market.resetOverrides()}>Reset to defaults</button
				>
			{/if}
		</div>
	{/if}
</div>
