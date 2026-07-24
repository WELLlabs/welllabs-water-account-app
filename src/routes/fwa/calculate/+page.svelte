<script lang="ts">
	import { onMount } from 'svelte';
	import {
		calculateWaterSchedule,
		cropTotalM3PerAcre,
		formatCalendarMonth,
		parseWaterBudgetCsv,
		type WaterBudgetRow
	} from '$lib/waterBudget';

	const CROP_COLORS = [
		'#0ea5e9',
		'#f97316',
		'#a855f7',
		'#ef4444',
		'#14b8a6',
		'#d97706',
		'#78716c',
		'#e11d48',
		'#6366f1',
		'#84cc16'
	];

	interface CropDef {
		id: string;
		name: string;
		row: WaterBudgetRow;
		color: string;
	}

	interface Allocation {
		cropId: string;
		pct: number;
	}

	let budgetRows = $state<WaterBudgetRow[]>([]);
	let cropDefs = $state<CropDef[]>([]);
	let loadError = $state<string | null>(null);
	let totalAcreage = $state(100);
	let startDate = $state(defaultStartDate());
	let allocations = $state<Allocation[]>([]);

	function defaultStartDate(): string {
		const d = new Date();
		const y = d.getFullYear();
		const m = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		return `${y}-${m}-${day}`;
	}

	onMount(async () => {
		try {
			const res = await fetch('/total_water_needed.csv');
			if (!res.ok) throw new Error('Could not load total_water_needed.csv');
			const text = await res.text();
			const rows = parseWaterBudgetCsv(text);
			budgetRows = rows;
			cropDefs = [
				...rows.map((row, i) => ({
					id: row.crop.toLowerCase().replace(/\s+/g, '-'),
					name: row.crop,
					row,
					color: CROP_COLORS[i % CROP_COLORS.length]
				})),
				{
					id: 'fallow',
					name: 'Fallow',
					row: { crop: 'Fallow', monthM3PerAcre: [] },
					color: '#94a3b8'
				}
			];
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Failed to load water budget.';
		}
	});

	let totalPct = $derived(allocations.reduce((s, a) => s + a.pct, 0));
	let remaining = $derived(Math.max(0, 100 - totalPct));
	let isValid = $derived(Math.abs(totalPct - 100) < 0.1);

	function getCrop(id: string): CropDef {
		return cropDefs.find((c) => c.id === id) ?? cropDefs[0];
	}

	function fmt(m3: number): string {
		return Math.round(m3).toLocaleString('en-IN');
	}

	function cropSeasonalM3(alloc: Allocation): number {
		const crop = getCrop(alloc.cropId);
		if (crop.id === 'fallow') return 0;
		const acres = (totalAcreage * alloc.pct) / 100;
		return cropTotalM3PerAcre(crop.row) * acres;
	}

	function cropMonthNeeds(alloc: Allocation) {
		const crop = getCrop(alloc.cropId);
		if (crop.id === 'fallow') return [];
		const acres = (totalAcreage * alloc.pct) / 100;
		const schedule = calculateWaterSchedule(crop.name, startDate, budgetRows, acres);
		return schedule.matchedBudget ? schedule.monthlyNeeds : [];
	}

	let totalSeasonalM3 = $derived(allocations.reduce((s, a) => s + cropSeasonalM3(a), 0));

	/** Overall month-wise totals across all allocations */
	let overallMonths = $derived.by(() => {
		const map = new Map<
			string,
			{ calendarMonth: number; calendarYear: number; waterM3: number; byCrop: Map<string, number> }
		>();

		for (const alloc of allocations) {
			for (const need of cropMonthNeeds(alloc)) {
				const key = `${need.calendarYear}-${need.calendarMonth}`;
				let row = map.get(key);
				if (!row) {
					row = {
						calendarMonth: need.calendarMonth,
						calendarYear: need.calendarYear,
						waterM3: 0,
						byCrop: new Map()
					};
					map.set(key, row);
				}
				row.waterM3 += need.waterM3;
				row.byCrop.set(alloc.cropId, (row.byCrop.get(alloc.cropId) ?? 0) + need.waterM3);
			}
		}

		return Array.from(map.values()).sort(
			(a, b) => a.calendarYear * 100 + a.calendarMonth - (b.calendarYear * 100 + b.calendarMonth)
		);
	});

	let peakMonthM3 = $derived(
		overallMonths.length > 0 ? Math.max(...overallMonths.map((m) => m.waterM3)) : 0
	);

	let irrigatedAllocations = $derived(allocations.filter((a) => getCrop(a.cropId).id !== 'fallow'));

	function addCrop(cropId: string) {
		if (allocations.find((a) => a.cropId === cropId)) return;
		const next = [...allocations, { cropId, pct: 0 }];
		const even = +(100 / next.length).toFixed(1);
		const sumRest = even * (next.length - 1);
		allocations = next.map((a, i) => ({
			...a,
			pct: i === next.length - 1 ? +(100 - sumRest).toFixed(1) : even
		}));
	}

	function removeCrop(cropId: string) {
		const next = allocations.filter((a) => a.cropId !== cropId);
		if (next.length === 0) {
			allocations = [];
			return;
		}
		const even = +(100 / next.length).toFixed(1);
		const sumRest = even * (next.length - 1);
		allocations = next.map((a, i) => ({
			...a,
			pct: i === next.length - 1 ? +(100 - sumRest).toFixed(1) : even
		}));
	}

	function updatePct(cropId: string, raw: number) {
		const pct = Math.max(0, Math.min(100, isNaN(raw) ? 0 : raw));
		allocations = allocations.map((a) => (a.cropId === cropId ? { ...a, pct } : a));
	}

	function distributeEvenly() {
		if (allocations.length === 0) return;
		const even = +(100 / allocations.length).toFixed(1);
		const sumRest = even * (allocations.length - 1);
		allocations = allocations.map((a, i) => ({
			...a,
			pct: i === allocations.length - 1 ? +(100 - sumRest).toFixed(1) : even
		}));
	}

	function clearAll() {
		allocations = [];
	}

	let draggingCropId = $state<string | null>(null);
	let isDragOver = $state(false);

	function onPaletteDragStart(e: DragEvent, cropId: string) {
		draggingCropId = cropId;
		e.dataTransfer!.effectAllowed = 'copy';
		e.dataTransfer!.setData('text/plain', cropId);
	}
	function onBarDragOver(e: DragEvent) {
		e.preventDefault();
		e.dataTransfer!.dropEffect = 'copy';
		isDragOver = true;
	}
	function onBarDragLeave() {
		isDragOver = false;
	}
	function onBarDrop(e: DragEvent) {
		e.preventDefault();
		isDragOver = false;
		const cropId = e.dataTransfer?.getData('text/plain') ?? draggingCropId;
		if (cropId) addCrop(cropId);
		draggingCropId = null;
	}

	let barEl = $state<HTMLElement | null>(null);
	interface ResizeState {
		idx: number;
		startX: number;
		startPcts: number[];
		barWidth: number;
	}
	let resizing = $state<ResizeState | null>(null);

	function onDividerMouseDown(e: MouseEvent, idx: number) {
		if (!barEl) return;
		e.preventDefault();
		resizing = {
			idx,
			startX: e.clientX,
			startPcts: allocations.map((a) => a.pct),
			barWidth: barEl.getBoundingClientRect().width
		};
	}
	function onWindowMouseMove(e: MouseEvent) {
		if (!resizing) return;
		const dpct = ((e.clientX - resizing.startX) / resizing.barWidth) * 100;
		const combined = resizing.startPcts[resizing.idx] + resizing.startPcts[resizing.idx + 1];
		const newLeft = Math.max(1, Math.min(combined - 1, resizing.startPcts[resizing.idx] + dpct));
		const newRight = combined - newLeft;
		allocations = allocations.map((a, i) => {
			if (i === resizing!.idx) return { ...a, pct: newLeft };
			if (i === resizing!.idx + 1) return { ...a, pct: newRight };
			return a;
		});
	}
	function onWindowMouseUp() {
		if (resizing) {
			allocations = allocations.map((a) => ({ ...a, pct: Math.round(a.pct * 10) / 10 }));
			resizing = null;
		}
	}

	function cumulativePct(upToIdx: number): number {
		return allocations.slice(0, upToIdx + 1).reduce((s, a) => s + a.pct, 0);
	}
</script>

<svelte:window onmousemove={onWindowMouseMove} onmouseup={onWindowMouseUp} />

<div class="min-h-screen bg-slate-50">
	<div class="border-b border-slate-200 bg-white px-6 py-5">
		<div class="mx-auto max-w-7xl">
			<div class="flex flex-wrap items-end justify-between gap-4">
				<div>
					<h1 class="text-2xl font-semibold text-slate-900">Crop Water Calculator</h1>
					<p class="mt-0.5 text-sm text-slate-500">
						Allocate acreage and estimate water from the sowing start date, month by month.
					</p>
				</div>

				<div class="flex flex-wrap items-center gap-5">
					<div class="flex flex-col gap-1">
						<label for="start-date" class="text-xs font-medium text-slate-500">Start / sowing date</label>
						<input
							id="start-date"
							type="date"
							bind:value={startDate}
							class="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
						/>
					</div>

					<div class="flex flex-col gap-1">
						<label for="acreage" class="text-xs font-medium text-slate-500">Total Acreage</label>
						<div class="flex items-center gap-1.5">
							<input
								id="acreage"
								type="number"
								min="0"
								step="1"
								bind:value={totalAcreage}
								class="w-28 rounded-lg border border-slate-300 px-3 py-1.5 text-right text-sm font-medium focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
							/>
							<span class="text-sm text-slate-500">acres</span>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>

	<div class="mx-auto max-w-7xl px-6 py-6">
		{#if loadError}
			<div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
				{loadError}
			</div>
		{:else if cropDefs.length === 0}
			<p class="text-sm text-slate-500">Loading crop water data…</p>
		{:else}
			<div class="flex gap-6">
				<aside class="w-44 shrink-0">
					<h2 class="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Crops</h2>
					<p class="mb-3 text-xs leading-relaxed text-slate-400">
						Click or drag onto the bar to add.
					</p>

					<div class="space-y-1.5">
						{#each cropDefs as crop}
							{@const added = allocations.some((a) => a.cropId === crop.id)}
							<div
								draggable="true"
								role="button"
								tabindex="0"
								ondragstart={(e) => onPaletteDragStart(e, crop.id)}
								onclick={() => addCrop(crop.id)}
								onkeydown={(e) => e.key === 'Enter' && addCrop(crop.id)}
								class="flex cursor-grab select-none items-center gap-2.5 rounded-lg border px-3 py-2 transition-all active:cursor-grabbing
								{added
									? 'cursor-default border-slate-100 bg-slate-50 opacity-40'
									: 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'}"
							>
								<span
									class="h-2.5 w-2.5 shrink-0 rounded-full"
									style="background-color: {crop.color}"
								></span>
								<div class="min-w-0 flex-1">
									<div class="truncate text-xs font-medium text-slate-800">{crop.name}</div>
									{#if crop.id === 'fallow'}
										<div class="text-xs text-slate-400">No water req.</div>
									{:else}
										<div class="text-xs text-slate-400">
											{crop.row.monthM3PerAcre.filter((v) => v !== null).length} months ·
											{fmt(cropTotalM3PerAcre(crop.row))} m³/ac
										</div>
									{/if}
								</div>
								{#if added}
									<svg class="h-3 w-3 shrink-0 text-emerald-500" viewBox="0 0 20 20" fill="currentColor">
										<path
											fill-rule="evenodd"
											d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
											clip-rule="evenodd"
										/>
									</svg>
								{/if}
							</div>
						{/each}
					</div>
				</aside>

				<div class="min-w-0 flex-1">
					<div class="mb-2 flex items-center justify-between">
						<div class="flex items-center gap-2">
							<span class="text-sm font-medium text-slate-700">Allocation Bar</span>
							{#if totalPct > 0.01}
								<span
									class="rounded-full px-2 py-0.5 text-xs font-medium
									{isValid
										? 'bg-emerald-50 text-emerald-700'
										: totalPct > 100
											? 'bg-red-50 text-red-700'
											: 'bg-amber-50 text-amber-700'}"
								>
									{totalPct.toFixed(1)}% allocated{#if !isValid && remaining > 0.05}
										· {remaining.toFixed(1)}% free{/if}
								</span>
							{/if}
						</div>
						{#if allocations.length > 0}
							<div class="flex gap-2">
								<button
									onclick={distributeEvenly}
									class="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
								>
									Distribute evenly
								</button>
								<button
									onclick={clearAll}
									class="rounded-md border border-red-100 bg-white px-2.5 py-1 text-xs font-medium text-red-500 hover:bg-red-50"
								>
									Clear all
								</button>
							</div>
						{/if}
					</div>

					<div
						bind:this={barEl}
						role="region"
						aria-label="Crop allocation drop zone"
						ondragover={onBarDragOver}
						ondragleave={onBarDragLeave}
						ondrop={onBarDrop}
						class="relative flex h-20 w-full overflow-hidden rounded-2xl border-2 transition-colors duration-150
						{isDragOver
							? 'border-blue-400 bg-blue-50'
							: allocations.length === 0
								? 'border-dashed border-slate-300 bg-slate-100'
								: 'border-transparent'}"
					>
						{#if allocations.length === 0}
							<div class="flex w-full items-center justify-center">
								<p class="text-sm text-slate-400">
									{isDragOver ? 'Drop to add →' : 'Drag crops here to start planning'}
								</p>
							</div>
						{:else}
							{#each allocations as alloc}
								{@const crop = getCrop(alloc.cropId)}
								<div
									class="relative flex h-full shrink-0 items-center justify-center overflow-hidden"
									style="width: {alloc.pct}%; background-color: {crop.color}; transition: width {resizing
										? '0ms'
										: '120ms'} ease;"
								>
									{#if alloc.pct > 6}
										<div class="pointer-events-none select-none text-center">
											<div class="truncate px-1 text-xs font-semibold leading-tight text-white/95">
												{crop.name}
											</div>
											<div class="text-xs text-white/75">{alloc.pct.toFixed(1)}%</div>
										</div>
									{/if}
								</div>
							{/each}

							{#if remaining > 0.5}
								<div
									class="flex h-full shrink-0 items-center justify-center bg-slate-200"
									style="width: {remaining}%"
								>
									{#if remaining > 8}
										<span class="text-xs text-slate-500">{remaining.toFixed(1)}% free</span>
									{/if}
								</div>
							{/if}

							{#each allocations as _, i}
								{#if i < allocations.length - 1}
									<div
										role="separator"
										aria-label="Resize handle"
										class="absolute top-0 z-10 h-full w-2 cursor-col-resize hover:bg-white/20"
										style="left: calc({cumulativePct(i)}% - 4px)"
										onmousedown={(e) => onDividerMouseDown(e, i)}
									>
										<div
											class="absolute left-1/2 top-2 h-[calc(100%-1rem)] w-0.5 -translate-x-1/2 rounded-full bg-white/50"
										></div>
									</div>
								{/if}
							{/each}
						{/if}
					</div>

					{#if allocations.length > 1}
						<p class="mt-1.5 text-xs text-slate-400">
							Drag the dividers in the bar to resize, or edit percentages in the rows below.
						</p>
					{/if}

					{#if allocations.length > 0}
						<div class="mt-5 space-y-2">
							{#each allocations as alloc}
								{@const crop = getCrop(alloc.cropId)}
								{@const acres = (totalAcreage * alloc.pct) / 100}
								{@const waterM3 = cropSeasonalM3(alloc)}
								<div
									class="flex items-center gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3"
								>
									<span
										class="h-4 w-4 shrink-0 rounded-full"
										style="background-color: {crop.color}"
									></span>

									<div class="min-w-0 flex-1">
										<div class="text-sm font-medium text-slate-900">{crop.name}</div>
										<div class="text-xs text-slate-400">
											{#if crop.id === 'fallow'}
												No irrigation requirement
											{:else}
												From {startDate} ·
												{crop.row.monthM3PerAcre.filter((v) => v !== null).length} months
											{/if}
										</div>
									</div>

									<div class="flex items-center gap-1">
										<input
											type="number"
											min="0"
											max="100"
											step="0.1"
											value={alloc.pct}
											onchange={(e) =>
												updatePct(alloc.cropId, parseFloat((e.target as HTMLInputElement).value))}
											oninput={(e) =>
												updatePct(alloc.cropId, parseFloat((e.target as HTMLInputElement).value))}
											class="w-16 rounded-md border border-slate-300 px-2 py-1 text-center text-sm font-medium focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
										/>
										<span class="text-sm text-slate-400">%</span>
									</div>

									<div class="w-20 text-right">
										<div class="text-sm font-semibold text-slate-800">{acres.toFixed(1)}</div>
										<div class="text-xs text-slate-400">acres</div>
									</div>

									<div class="w-32 text-right">
										{#if crop.id !== 'fallow'}
											<div class="text-sm font-semibold text-sky-700">{fmt(waterM3)} m³</div>
											<div class="text-xs text-slate-400">
												{fmt(cropTotalM3PerAcre(crop.row))} m³/ac
											</div>
										{:else}
											<div class="text-sm text-slate-400">—</div>
											<div class="text-xs text-slate-400">no water req.</div>
										{/if}
									</div>

									<button
										onclick={() => removeCrop(alloc.cropId)}
										aria-label="Remove {crop.name}"
										class="ml-1 rounded p-0.5 text-slate-300 transition-colors hover:text-red-500"
									>
										<svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
											<path
												fill-rule="evenodd"
												d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
												clip-rule="evenodd"
											/>
										</svg>
									</button>
								</div>
							{/each}
						</div>

						<div class="mt-3 rounded-xl border border-slate-200 bg-white px-5 py-4">
							<div class="flex flex-wrap items-center justify-between gap-4">
								<div>
									<div class="text-sm font-semibold text-slate-900">Total</div>
									<div class="mt-0.5 text-xs text-slate-400">
										{allocations.length} crop{allocations.length !== 1 ? 's' : ''} · {totalAcreage} acres
										· start {startDate}
									</div>
								</div>
								<div class="flex gap-8">
									<div class="text-right">
										<div class="text-lg font-bold text-slate-800">{totalAcreage.toFixed(0)} ac</div>
										<div class="text-xs text-slate-400">allocated {totalPct.toFixed(1)}%</div>
									</div>
									<div class="text-right">
										<div class="text-lg font-bold text-sky-600">{fmt(totalSeasonalM3)} m³</div>
										<div class="text-xs text-slate-400">total water need</div>
									</div>
								</div>
							</div>

							{#if !isValid && totalPct > 0.1}
								<div
									class="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700"
								>
									{totalPct < 100
										? `${remaining.toFixed(1)}% unallocated — water estimate covers allocated area only.`
										: 'Total exceeds 100%. Adjust percentages below.'}
								</div>
							{/if}
						</div>

						{#if overallMonths.length > 0}
							<div class="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
								<div class="border-b border-slate-100 px-5 py-3">
									<h3 class="text-sm font-semibold text-slate-800">
										Month-wise Water Requirement (m³)
									</h3>
									<p class="mt-0.5 text-xs text-slate-400">
										Month 1 starts at the sowing date ({startDate}). Values are cubic metres (m³).
									</p>
								</div>

								<div class="overflow-x-auto">
									<table class="w-full text-xs">
										<thead>
											<tr class="border-b border-slate-100 bg-slate-50">
												<th
													class="sticky left-0 bg-slate-50 px-4 py-2.5 text-left font-semibold text-slate-600"
													>Month</th
												>
												{#each irrigatedAllocations as alloc}
													{@const crop = getCrop(alloc.cropId)}
													<th class="px-3 py-2.5 text-right font-semibold" style="color: {crop.color}">
														{crop.name}
													</th>
												{/each}
												<th class="px-4 py-2.5 text-right font-semibold text-slate-700">Total</th>
											</tr>
										</thead>
										<tbody>
											{#each overallMonths as month}
												{@const barWidth =
													peakMonthM3 > 0 ? (month.waterM3 / peakMonthM3) * 100 : 0}
												<tr class="border-b border-slate-50 hover:bg-slate-50/60">
													<td
														class="sticky left-0 bg-white px-4 py-2.5 font-medium text-slate-700"
													>
														{formatCalendarMonth(month.calendarMonth, month.calendarYear)}
													</td>
													{#each irrigatedAllocations as alloc}
														{@const m3 = month.byCrop.get(alloc.cropId) ?? 0}
														<td class="px-3 py-2.5 text-right tabular-nums text-slate-600">
															{m3 > 0 ? fmt(m3) : '—'}
														</td>
													{/each}
													<td
														class="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-800"
													>
														<div class="flex items-center justify-end gap-2">
															<div class="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
																<div
																	class="h-full rounded-full bg-sky-500"
																	style="width: {barWidth.toFixed(1)}%"
																></div>
															</div>
															{fmt(month.waterM3)}
														</div>
													</td>
												</tr>
											{/each}
											<tr class="border-t-2 border-slate-200 bg-slate-50 font-semibold">
												<td class="sticky left-0 bg-slate-50 px-4 py-3 text-slate-800"
													>Season Total</td
												>
												{#each irrigatedAllocations as alloc}
													{@const crop = getCrop(alloc.cropId)}
													<td class="px-3 py-3 text-right tabular-nums" style="color: {crop.color}">
														{fmt(cropSeasonalM3(alloc))}
													</td>
												{/each}
												<td class="px-4 py-3 text-right tabular-nums text-slate-900">
													{fmt(totalSeasonalM3)}
												</td>
											</tr>
										</tbody>
									</table>
								</div>
							</div>
						{/if}
					{/if}
				</div>
			</div>
		{/if}
	</div>
</div>
