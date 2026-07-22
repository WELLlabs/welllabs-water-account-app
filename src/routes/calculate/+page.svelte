<script lang="ts">
	// ─── Constants ────────────────────────────────────────────────────────────
	const ACRE_M2 = 4046.8564224;

	type Month =
		| 'June'
		| 'July'
		| 'August'
		| 'September'
		| 'October'
		| 'November'
		| 'December'
		| 'January'
		| 'February'
		| 'March'
		| 'April'
		| 'May';

	const KHARIF_MONTHS: Month[] = [
		'June',
		'July',
		'August',
		'September',
		'October',
		'November',
		'December'
	];
	const RABI_MONTHS: Month[] = [
		'November',
		'December',
		'January',
		'February',
		'March',
		'April'
	];

	interface CropDef {
		id: string;
		name: string;
		season: 'Kharif' | 'Rabi' | '—';
		startMonth: string;
		endMonth: string;
		monthlyMm: Partial<Record<Month, number>>;
		color: string;
	}

	// Monthly mm/acre values sourced directly from farm_water_budget.csv
	const CROP_DEFS: CropDef[] = [
		{
			id: 'paddy-kharif',
			name: 'Paddy',
			season: 'Kharif',
			startMonth: 'Jun 15',
			endMonth: 'Nov 15',
			monthlyMm: { June: 804.64, July: 668.92, August: 758.11, September: 625.93, October: 552.31, November: 193.07 },
			color: '#0ea5e9'
		},
		{
			id: 'paddy-rabi',
			name: 'Paddy',
			season: 'Rabi',
			startMonth: 'Nov 15',
			endMonth: 'Apr 15',
			monthlyMm: { November: 210.49, December: 621.29, January: 804.47, February: 870.43, March: 942.76, April: 388.92 },
			color: '#2563eb'
		},
		{
			id: 'cotton',
			name: 'Cotton',
			season: 'Kharif',
			startMonth: 'Jun 1',
			endMonth: 'Dec 15',
			monthlyMm: { June: 447.83, July: 421.14, August: 566.26, September: 610.23, October: 545.84, November: 378.85, December: 241.44 },
			color: '#f97316'
		},
		{
			id: 'groundnut',
			name: 'Groundnut',
			season: 'Rabi',
			startMonth: 'Dec 15',
			endMonth: 'Apr 25',
			monthlyMm: { January: 451.01, February: 687.73, March: 1000.96, April: 399.2 },
			color: '#a855f7'
		},
		{
			id: 'pulses-arhar',
			name: 'Pulses (Arhar)',
			season: 'Kharif',
			startMonth: 'Jun 21',
			endMonth: 'Dec 10',
			monthlyMm: { June: 293.58, July: 297.66, August: 540.15, September: 563.15, October: 561.89, November: 291.76, December: 124.12 },
			color: '#ef4444'
		},
		{
			id: 'pulses-gram',
			name: 'Pulses (Gram)',
			season: 'Rabi',
			startMonth: 'Dec 15',
			endMonth: 'Mar 28',
			monthlyMm: { January: 471.14, February: 718.94, March: 695.78 },
			color: '#ec4899'
		},
		{
			id: 'millets-sorghum',
			name: 'Millets (Sorghum)',
			season: 'Kharif',
			startMonth: 'Jun 25',
			endMonth: 'Nov 15',
			monthlyMm: { June: 241.37, July: 238.52, August: 490.37, September: 531.76, October: 407.65, November: 28.58 },
			color: '#14b8a6'
		},
		{
			id: 'millets-bajra',
			name: 'Millets (Bajra)',
			season: 'Rabi',
			startMonth: 'Nov 15',
			endMonth: 'Mar 1',
			monthlyMm: { December: 407.55, January: 690.94, February: 515.43, March: 25.79 },
			color: '#6366f1'
		},
		{
			id: 'sunflower',
			name: 'Sunflower',
			season: 'Kharif',
			startMonth: 'Jun 5',
			endMonth: 'Oct 15',
			monthlyMm: { June: 406.3, July: 361.73, August: 595.4, September: 432.37, October: 102.52 },
			color: '#d97706'
		},
		{
			id: 'sesame',
			name: 'Sesame',
			season: 'Rabi',
			startMonth: 'Nov 21',
			endMonth: 'Mar 10',
			monthlyMm: { December: 342.04, January: 676.4, February: 709.18, March: 180.51 },
			color: '#78716c'
		},
		{
			id: 'fallow',
			name: 'Fallow',
			season: '—',
			startMonth: '—',
			endMonth: '—',
			monthlyMm: {},
			color: '#94a3b8'
		}
	];

	// ─── State ───────────────────────────────────────────────────────────────
	interface Allocation {
		cropId: string;
		pct: number;
	}

	type Season = 'Kharif' | 'Rabi';

	let totalAcreage = $state(100);
	let allocations = $state<Allocation[]>([]);
	let season = $state<Season>('Kharif');

	// ─── Derived ─────────────────────────────────────────────────────────────
	let activeMonths = $derived(season === 'Kharif' ? KHARIF_MONTHS : RABI_MONTHS);

	let visibleCrops = $derived(
		CROP_DEFS.filter((c) => c.season === season || c.season === '—')
	);

	let totalPct = $derived(allocations.reduce((s, a) => s + a.pct, 0));
	let remaining = $derived(Math.max(0, 100 - totalPct));
	let isValid = $derived(Math.abs(totalPct - 100) < 0.1);

	function getCrop(id: string): CropDef {
		return CROP_DEFS.find((c) => c.id === id) ?? CROP_DEFS[0];
	}

	function cropTotalMm(crop: CropDef): number {
		return Object.values(crop.monthlyMm).reduce((s, v) => s + (v ?? 0), 0);
	}

	/** mm depth over `acres` → m³ */
	function mmToM3(mm: number, acres: number): number {
		return (mm / 1000) * acres * ACRE_M2;
	}

	function fmt(m3: number): string {
		return Math.round(m3).toLocaleString('en-IN');
	}

	function cropSeasonalM3(alloc: Allocation): number {
		const crop = getCrop(alloc.cropId);
		const acres = (totalAcreage * alloc.pct) / 100;
		return mmToM3(cropTotalMm(crop), acres);
	}

	let totalSeasonalM3 = $derived(allocations.reduce((s, a) => s + cropSeasonalM3(a), 0));

	/** m³ for a specific crop+month, given current acreage allocation */
	function cropMonthM3(alloc: Allocation, month: Month): number {
		const crop = getCrop(alloc.cropId);
		const mm = crop.monthlyMm[month] ?? 0;
		if (mm === 0) return 0;
		const acres = (totalAcreage * alloc.pct) / 100;
		return mmToM3(mm, acres);
	}

	/** Total m³ across all allocated crops for a given month */
	function monthTotalM3(month: Month): number {
		return allocations.reduce((s, a) => s + cropMonthM3(a, month), 0);
	}

	/** Months that have at least one non-zero value across allocated crops */
	let usedMonths = $derived(
		activeMonths.filter((m) => allocations.some((a) => (getCrop(a.cropId).monthlyMm[m] ?? 0) > 0))
	);

	let peakMonthM3 = $derived(
		usedMonths.length > 0 ? Math.max(...usedMonths.map((m) => monthTotalM3(m))) : 0
	);

	// ─── Add / Remove ─────────────────────────────────────────────────────────
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
		if (next.length === 0) { allocations = []; return; }
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

	// When season changes, remove crops that don't belong to the new season
	function switchSeason(s: Season) {
		season = s;
		allocations = allocations.filter((a) => {
			const c = getCrop(a.cropId);
			return c.season === s || c.season === '—';
		});
		if (allocations.length > 0) distributeEvenly();
	}

	// ─── Drag from palette ────────────────────────────────────────────────────
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
	function onBarDragLeave() { isDragOver = false; }
	function onBarDrop(e: DragEvent) {
		e.preventDefault();
		isDragOver = false;
		const cropId = e.dataTransfer?.getData('text/plain') ?? draggingCropId;
		if (cropId) addCrop(cropId);
		draggingCropId = null;
	}

	// ─── Resize dividers ──────────────────────────────────────────────────────
	let barEl = $state<HTMLElement | null>(null);
	interface ResizeState { idx: number; startX: number; startPcts: number[]; barWidth: number; }
	let resizing = $state<ResizeState | null>(null);

	function onDividerMouseDown(e: MouseEvent, idx: number) {
		if (!barEl) return;
		e.preventDefault();
		resizing = { idx, startX: e.clientX, startPcts: allocations.map((a) => a.pct), barWidth: barEl.getBoundingClientRect().width };
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
	<!-- Page header -->
	<div class="border-b border-slate-200 bg-white px-6 py-5">
		<div class="mx-auto max-w-7xl">
			<div class="flex flex-wrap items-end justify-between gap-4">
				<div>
					<h1 class="text-2xl font-semibold text-slate-900">Crop Water Calculator</h1>
					<p class="mt-0.5 text-sm text-slate-500">
						Plan your seasonal acreage allocation and see water needs month by month.
					</p>
				</div>

				<div class="flex items-center gap-5">
					<!-- Season selector -->
					<div class="flex flex-col gap-1">
						<span class="text-xs font-medium text-slate-500">Season</span>
						<div class="flex rounded-lg border border-slate-200 bg-slate-100 p-0.5">
							{#each (['Kharif', 'Rabi'] as const) as s}
								<button
									onclick={() => switchSeason(s)}
									class="rounded-md px-5 py-1.5 text-sm font-semibold transition-colors
                                           {season === s ? 'bg-white text-slate-900' : 'text-slate-500 hover:text-slate-700'}"
								>
									{s}
								</button>
							{/each}
						</div>
					</div>

					<!-- Acreage -->
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
		<div class="flex gap-6">
			<!-- ── Crop Palette ── -->
			<aside class="w-44 shrink-0">
				<h2 class="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
					{season} Crops
				</h2>
				<p class="mb-3 text-xs leading-relaxed text-slate-400">
					Click or drag onto the bar to add.
				</p>

				<div class="space-y-1.5">
					{#each visibleCrops as crop}
						{@const added = allocations.some((a) => a.cropId === crop.id)}
						<div
							draggable="true"
							role="button"
							tabindex="0"
							ondragstart={(e) => onPaletteDragStart(e, crop.id)}
							onclick={() => addCrop(crop.id)}
							onkeydown={(e) => e.key === 'Enter' && addCrop(crop.id)}
							class="flex cursor-grab select-none items-center gap-2.5 rounded-lg border px-3 py-2 transition-all active:cursor-grabbing
                                   {added ? 'border-slate-100 bg-slate-50 opacity-40 cursor-default' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'}"
						>
							<span class="h-2.5 w-2.5 shrink-0 rounded-full" style="background-color: {crop.color}"></span>
							<div class="min-w-0 flex-1">
								<div class="truncate text-xs font-medium text-slate-800">{crop.name}</div>
								{#if crop.season !== '—'}
									<div class="text-xs text-slate-400">{crop.startMonth}–{crop.endMonth}</div>
								{:else}
									<div class="text-xs text-slate-400">No water req.</div>
								{/if}
							</div>
							{#if added}
								<svg class="h-3 w-3 shrink-0 text-emerald-500" viewBox="0 0 20 20" fill="currentColor">
									<path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
								</svg>
							{/if}
						</div>
					{/each}
				</div>
			</aside>

			<!-- ── Main Editor ── -->
			<div class="min-w-0 flex-1">

				<!-- Bar toolbar -->
				<div class="mb-2 flex items-center justify-between">
					<div class="flex items-center gap-2">
						<span class="text-sm font-medium text-slate-700">Allocation Bar</span>
						{#if totalPct > 0.01}
							<span class="rounded-full px-2 py-0.5 text-xs font-medium
                                {isValid ? 'bg-emerald-50 text-emerald-700' : totalPct > 100 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}">
								{totalPct.toFixed(1)}% allocated{#if !isValid && remaining > 0.05} · {remaining.toFixed(1)}% free{/if}
							</span>
						{/if}
					</div>
					{#if allocations.length > 0}
						<div class="flex gap-2">
							<button onclick={distributeEvenly} class="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
								Distribute evenly
							</button>
							<button onclick={clearAll} class="rounded-md border border-red-100 bg-white px-2.5 py-1 text-xs font-medium text-red-500 hover:bg-red-50">
								Clear all
							</button>
						</div>
					{/if}
				</div>

				<!-- Stacked bar -->
				<div
					bind:this={barEl}
					role="region"
					aria-label="Crop allocation drop zone"
					ondragover={onBarDragOver}
					ondragleave={onBarDragLeave}
					ondrop={onBarDrop}
					class="relative flex h-20 w-full overflow-hidden rounded-2xl border-2 transition-colors duration-150
                           {isDragOver ? 'border-blue-400 bg-blue-50' : allocations.length === 0 ? 'border-dashed border-slate-300 bg-slate-100' : 'border-transparent'}"
				>
					{#if allocations.length === 0}
						<div class="flex w-full items-center justify-center">
							<p class="text-sm text-slate-400">{isDragOver ? 'Drop to add →' : 'Drag crops here to start planning'}</p>
						</div>
					{:else}
						{#each allocations as alloc, i}
							{@const crop = getCrop(alloc.cropId)}
							<div
								class="relative flex h-full shrink-0 items-center justify-center overflow-hidden"
								style="width: {alloc.pct}%; background-color: {crop.color}; transition: width {resizing ? '0ms' : '120ms'} ease;"
							>
								{#if alloc.pct > 6}
									<div class="pointer-events-none select-none text-center">
										<div class="truncate px-1 text-xs font-semibold leading-tight text-white/95">{crop.name}</div>
										<div class="text-xs text-white/75">{alloc.pct.toFixed(1)}%</div>
									</div>
								{/if}
							</div>
						{/each}

						{#if remaining > 0.5}
							<div class="flex h-full shrink-0 items-center justify-center bg-slate-200" style="width: {remaining}%">
								{#if remaining > 8}<span class="text-xs text-slate-500">{remaining.toFixed(1)}% free</span>{/if}
							</div>
						{/if}

						<!-- Resize dividers -->
						{#each allocations as _, i}
							{#if i < allocations.length - 1}
								<div
									role="separator"
									aria-label="Resize handle"
									class="absolute top-0 z-10 h-full w-2 cursor-col-resize hover:bg-white/20"
									style="left: calc({cumulativePct(i)}% - 4px)"
									onmousedown={(e) => onDividerMouseDown(e, i)}
								>
									<div class="absolute left-1/2 top-2 h-[calc(100%-1rem)] w-0.5 -translate-x-1/2 rounded-full bg-white/50"></div>
								</div>
							{/if}
						{/each}
					{/if}
				</div>

				{#if allocations.length > 1}
					<p class="mt-1.5 text-xs text-slate-400">Drag the dividers in the bar to resize, or edit percentages in the rows below.</p>
				{/if}

				<!-- ── Allocation rows ── -->
				{#if allocations.length > 0}
					<div class="mt-5 space-y-2">
						{#each allocations as alloc}
							{@const crop = getCrop(alloc.cropId)}
							{@const acres = (totalAcreage * alloc.pct) / 100}
							{@const waterM3 = cropSeasonalM3(alloc)}
							<div class="flex items-center gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
								<span class="h-4 w-4 shrink-0 rounded-full" style="background-color: {crop.color}"></span>

								<div class="min-w-0 flex-1">
									<div class="text-sm font-medium text-slate-900">{crop.name}</div>
									<div class="text-xs text-slate-400">
										{#if crop.season !== '—'}{crop.season} · {crop.startMonth} → {crop.endMonth}{:else}No irrigation requirement{/if}
									</div>
								</div>

								<!-- % input -->
								<div class="flex items-center gap-1">
									<input
										type="number" min="0" max="100" step="0.1"
										value={alloc.pct}
										onchange={(e) => updatePct(alloc.cropId, parseFloat((e.target as HTMLInputElement).value))}
										oninput={(e) => updatePct(alloc.cropId, parseFloat((e.target as HTMLInputElement).value))}
										class="w-16 rounded-md border border-slate-300 px-2 py-1 text-center text-sm font-medium focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
									/>
									<span class="text-sm text-slate-400">%</span>
								</div>

								<!-- Acres -->
								<div class="w-20 text-right">
									<div class="text-sm font-semibold text-slate-800">{acres.toFixed(1)}</div>
									<div class="text-xs text-slate-400">acres</div>
								</div>

								<!-- Seasonal water -->
								<div class="w-32 text-right">
									{#if cropTotalMm(crop) > 0}
										<div class="text-sm font-semibold text-sky-700">{fmt(waterM3)} m³</div>
										<div class="text-xs text-slate-400">{cropTotalMm(crop).toFixed(0)} mm/ac</div>
									{:else}
										<div class="text-sm text-slate-400">—</div>
										<div class="text-xs text-slate-400">no water req.</div>
									{/if}
								</div>

								<button onclick={() => removeCrop(alloc.cropId)} aria-label="Remove {crop.name}"
									class="ml-1 rounded p-0.5 text-slate-300 transition-colors hover:text-red-500">
									<svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
										<path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
									</svg>
								</button>
							</div>
						{/each}
					</div>

					<!-- ── Totals row ── -->
					<div class="mt-3 rounded-xl border border-slate-200 bg-white px-5 py-4">
						<div class="flex flex-wrap items-center justify-between gap-4">
							<div>
								<div class="text-sm font-semibold text-slate-900">Total · {season} Season</div>
								<div class="mt-0.5 text-xs text-slate-400">
									{allocations.length} crop{allocations.length !== 1 ? 's' : ''} · {totalAcreage} acres
								</div>
							</div>
							<div class="flex gap-8">
								<div class="text-right">
									<div class="text-lg font-bold text-slate-800">{totalAcreage.toFixed(0)} ac</div>
									<div class="text-xs text-slate-400">allocated {totalPct.toFixed(1)}%</div>
								</div>
								<div class="text-right">
									<div class="text-lg font-bold text-sky-600">{fmt(totalSeasonalM3)} m³</div>
									<div class="text-xs text-slate-400">total seasonal need</div>
								</div>
							</div>
						</div>

						{#if !isValid && totalPct > 0.1}
							<div class="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
								{totalPct < 100
									? `${remaining.toFixed(1)}% unallocated — water estimate covers allocated area only.`
									: 'Total exceeds 100%. Adjust percentages below.'}
							</div>
						{/if}
					</div>

					<!-- ── Month-wise breakdown ── -->
					{#if usedMonths.length > 0}
						<div class="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
							<div class="border-b border-slate-100 px-5 py-3">
								<h3 class="text-sm font-semibold text-slate-800">Month-wise Water Requirement (m³)</h3>
								<p class="mt-0.5 text-xs text-slate-400">Based on {totalAcreage} acres at current allocation. Values are cubic metres (m³).</p>
							</div>

							<div class="overflow-x-auto">
								<table class="w-full text-xs">
									<thead>
										<tr class="border-b border-slate-100 bg-slate-50">
											<th class="sticky left-0 bg-slate-50 px-4 py-2.5 text-left font-semibold text-slate-600">Month</th>
											{#each allocations.filter(a => cropTotalMm(getCrop(a.cropId)) > 0) as alloc}
												{@const crop = getCrop(alloc.cropId)}
												<th class="px-3 py-2.5 text-right font-semibold" style="color: {crop.color}">
													{crop.name}
												</th>
											{/each}
											<th class="px-4 py-2.5 text-right font-semibold text-slate-700">Total</th>
										</tr>
									</thead>
									<tbody>
										{#each usedMonths as month}
											{@const monthTotal = monthTotalM3(month)}
											{@const barWidth = peakMonthM3 > 0 ? (monthTotal / peakMonthM3) * 100 : 0}
											<tr class="border-b border-slate-50 hover:bg-slate-50/60">
												<td class="sticky left-0 bg-white px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-50/60">
													{month}
												</td>
												{#each allocations.filter(a => cropTotalMm(getCrop(a.cropId)) > 0) as alloc}
													{@const m3 = cropMonthM3(alloc, month)}
													<td class="px-3 py-2.5 text-right tabular-nums text-slate-600">
														{m3 > 0 ? fmt(m3) : '—'}
													</td>
												{/each}
												<td class="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-800">
													<div class="flex items-center justify-end gap-2">
														<div class="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
															<div class="h-full rounded-full bg-sky-500" style="width: {barWidth.toFixed(1)}%"></div>
														</div>
														{fmt(monthTotal)}
													</div>
												</td>
											</tr>
										{/each}
										<!-- Season total row -->
										<tr class="border-t-2 border-slate-200 bg-slate-50 font-semibold">
											<td class="sticky left-0 bg-slate-50 px-4 py-3 text-slate-800">Season Total</td>
											{#each allocations.filter(a => cropTotalMm(getCrop(a.cropId)) > 0) as alloc}
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
	</div>
</div>
