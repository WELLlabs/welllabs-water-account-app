<script lang="ts">
	import { onMount } from 'svelte';
	import { enrichFeatureCollection, type ProcessedGeoJson } from '$lib/gpkgParser';
	import { collectDroppedFiles } from '$lib/shapefileImport';
	import { configureGeoPackage } from '$lib/setupGeopackage';
	import { parseWaterBudgetCsv } from '$lib/waterBudget';
	import {
		buildRegionPlots,
		cropColorMap,
		defaultSeasonKey,
		downloadCellsCsv,
		downloadCellsGeojson,
		downloadCropSummaryCsv,
		fetchCellFields,
		planRegion,
		readBoundaryFiles,
		seasonOptions,
		streamRegion,
		summarizeByCrop,
		summarizeCells,
		summarySeasonOptions,
		summaryTotals,
		type Boundary,
		type PlotOptions,
		type RegionCell,
		type RegionField,
		type RegionPlan
	} from '$lib/regionBudget';
	import CellSummaryMap from './CellSummaryMap.svelte';
	import PlotsPanel from './PlotsPanel.svelte';
	import SummaryStats from './SummaryStats.svelte';
	import SummaryTables from './SummaryTables.svelte';
	import { fmt, fmtAcres, fmtDuration } from './format';

	const TABLE_NAME = 'region_plots';
	const CONFIDENCE_OPTIONS = [
		{ value: 0, label: 'Any (top prediction)' },
		{ value: 0.3, label: '30% or higher' },
		{ value: 0.5, label: '50% or higher' },
		{ value: 0.7, label: '70% or higher' }
	];

	let budgetCsv = $state('');
	let error = $state<string | null>(null);
	let dragActive = $state(false);
	let reading = $state(false);

	let boundary = $state.raw<Boundary | null>(null);
	let plan = $state<RegionPlan | null>(null);
	let planError = $state<string | null>(null);
	let planning = $state(false);

	/** Plot mode: every plot in the boundary */
	let fields = $state.raw<RegionField[]>([]);
	/** Summary mode: crop totals per grid cell */
	let regionCells = $state.raw<RegionCell[]>([]);
	let fetching = $state(false);
	let progress = $state({ done: 0, total: 0, failed: 0, plots: 0 });
	let firstCellError = $state<string | null>(null);
	let incomplete = $state(false);
	let controller: AbortController | null = null;

	let seasonKey = $state('');
	let minConfidence = $state(0);
	let sowingDate = $state('');

	let selectedCell = $state<string | null>(null);
	let cellFields = $state.raw<RegionField[]>([]);
	let cellLoading = $state(false);
	let cellError = $state<string | null>(null);
	let cellController: AbortController | null = null;
	let cellSection = $state<HTMLElement | null>(null);

	let exportMenuOpen = $state(false);
	let exportMenuRef = $state<HTMLDivElement | null>(null);

	onMount(() => {
		configureGeoPackage();
		fetch('/total_water_needed.csv')
			.then((r) => (r.ok ? r.text() : Promise.reject(new Error('Could not load total_water_needed.csv'))))
			.then((t) => (budgetCsv = t))
			.catch((e) => (error = e.message));

		const closeMenu = (event: MouseEvent) => {
			if (exportMenuRef && !exportMenuRef.contains(event.target as Node)) exportMenuOpen = false;
		};
		document.addEventListener('click', closeMenu);
		return () => {
			document.removeEventListener('click', closeMenu);
			controller?.abort();
			cellController?.abort();
		};
	});

	const budgetRows = $derived(budgetCsv ? parseWaterBudgetCsv(budgetCsv) : []);
	const mode = $derived(plan?.mode ?? 'plots');
	const plotOptions = $derived<PlotOptions>({ seasonKey, minConfidence, sowingDate });
	const hasResults = $derived(mode === 'summary' ? regionCells.length > 0 : fields.length > 0);
	const seasons = $derived(mode === 'summary' ? summarySeasonOptions(regionCells) : seasonOptions(fields));

	function processPlots(source: RegionField[]): ProcessedGeoJson | null {
		if (!source.length || !seasonKey || !budgetCsv) return null;
		return enrichFeatureCollection(buildRegionPlots(source, plotOptions), TABLE_NAME, budgetCsv, {
			cropColumn: 'crop',
			sowingDateColumn: 'sowingDate',
			fallbackSeason: 'Kharif',
			acresColumn: 'acres',
			defaultAcres: 1
		});
	}

	const processed = $derived(mode === 'plots' ? processPlots(fields) : null);
	const cellSummary = $derived(
		mode === 'summary' && regionCells.length && seasonKey && budgetRows.length
			? summarizeCells(regionCells, plotOptions, budgetRows)
			: null
	);
	const summary = $derived(cellSummary ?? (processed ? summarizeByCrop(processed) : null));
	const totals = $derived(summary ? summaryTotals(summary) : null);
	const cropColors = $derived(cropColorMap(summary?.rows.map((r) => r.crop) ?? []));

	const selectedTotals = $derived(cellSummary?.cells.find((c) => c.id === selectedCell) ?? null);
	const detailProcessed = $derived(selectedCell ? processPlots(cellFields) : null);
	const detailSummary = $derived(detailProcessed ? summarizeByCrop(detailProcessed) : null);
	const detailTotals = $derived(detailSummary ? summaryTotals(detailSummary) : null);
	const detailBoundary = $derived<GeoJSON.FeatureCollection | null>(
		selectedTotals
			? {
					type: 'FeatureCollection',
					features: [
						{
							type: 'Feature',
							properties: {},
							geometry: { type: 'Polygon', coordinates: [[...selectedTotals.ring, selectedTotals.ring[0]]] }
						}
					]
				}
			: null
	);

	function reset() {
		controller?.abort();
		cellController?.abort();
		boundary = null;
		plan = null;
		planError = null;
		fields = [];
		regionCells = [];
		seasonKey = '';
		sowingDate = '';
		minConfidence = 0;
		incomplete = false;
		firstCellError = null;
		selectedCell = null;
		cellFields = [];
		error = null;
	}

	async function loadFiles(files: File[]) {
		if (!files.length) return;
		reset();
		reading = true;
		let uploaded: Boundary;
		try {
			uploaded = await readBoundaryFiles(files);
			boundary = uploaded;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not read the boundary file.';
			return;
		} finally {
			reading = false;
		}

		planning = true;
		try {
			plan = await planRegion(uploaded.featureCollection);
			boundary = {
				name: uploaded.name,
				polygons: uploaded.polygons,
				featureCollection: {
					type: 'FeatureCollection',
					features: [{ type: 'Feature', geometry: plan.boundary, properties: {} }]
				}
			};
		} catch (e) {
			planError = e instanceof Error ? e.message : 'Could not size the boundary.';
		} finally {
			planning = false;
		}
	}

	function onFileInput(event: Event) {
		const input = event.target as HTMLInputElement;
		const files = input.files ? Array.from(input.files) : [];
		input.value = '';
		loadFiles(files);
	}

	async function onDrop(event: DragEvent) {
		event.preventDefault();
		dragActive = false;
		if (event.dataTransfer) loadFiles(await collectDroppedFiles(event.dataTransfer));
	}

	async function fetchRegion() {
		if (!boundary || !plan) return;
		const kind = plan.mode === 'summary' ? 'summary' : 'fields';
		controller = new AbortController();
		cellController?.abort();
		const signal = controller.signal;
		const plots: RegionField[] = [];
		const cells: RegionCell[] = [];
		let finished = false;

		fetching = true;
		error = null;
		incomplete = false;
		firstCellError = null;
		fields = [];
		regionCells = [];
		selectedCell = null;
		cellFields = [];
		progress = { done: 0, total: plan.cells, failed: 0, plots: 0 };

		try {
			await streamRegion(
				kind,
				boundary.featureCollection,
				(msg) => {
					if (msg.type === 'start') {
						progress.total = msg.cells;
					} else if (msg.type === 'cell') {
						progress.done = msg.done;
						if (msg.error) {
							progress.failed++;
							firstCellError ??= msg.error;
						} else if (msg.features) {
							for (const f of msg.features) plots.push(f);
							progress.plots = plots.length;
						} else if (msg.ring) {
							cells.push({ id: msg.cellId, ring: msg.ring, plots: msg.plots ?? 0, area: msg.area ?? 0, rows: msg.rows ?? [] });
							progress.plots += msg.plots ?? 0;
						}
					} else if (msg.type === 'done') {
						finished = true;
					}
				},
				signal
			);
		} catch (e) {
			if (!signal.aborted) error = e instanceof Error ? e.message : 'Fetching crop data failed.';
		} finally {
			fetching = false;
			controller = null;
		}

		incomplete = !finished;
		if (kind === 'summary' && cells.length) {
			regionCells = cells;
			seasonKey = defaultSeasonKey(summarySeasonOptions(cells));
		} else if (kind === 'fields' && plots.length) {
			fields = plots;
			seasonKey = defaultSeasonKey(seasonOptions(plots));
		} else if (!error && finished) {
			error = 'No farm plots were found inside the boundary.';
		}
	}

	async function selectCell(id: string | null) {
		cellController?.abort();
		selectedCell = id;
		cellFields = [];
		cellError = null;
		if (!id || !boundary) return;

		const ctrl = new AbortController();
		cellController = ctrl;
		cellLoading = true;
		try {
			cellFields = await fetchCellFields(boundary.featureCollection, [id], ctrl.signal);
			if (!cellFields.length) cellError = 'No farm plots in this cell.';
		} catch (e) {
			if (!ctrl.signal.aborted) cellError = e instanceof Error ? e.message : 'Could not load plots for this cell.';
		} finally {
			if (cellController === ctrl) {
				cellLoading = false;
				cellController = null;
			}
		}
	}

	async function runExport(task: () => void) {
		exportMenuOpen = false;
		try {
			task();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Export failed.';
		}
	}
</script>

<div class="mx-auto max-w-7xl px-6 py-6">
	{#if error}
		<div class="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
	{/if}

	{#if !boundary}
		<section
			class="mx-auto max-w-xl rounded-xl border-2 border-dashed bg-white p-8 text-center transition-colors
			{dragActive ? 'border-blue-600 bg-blue-50' : 'border-slate-300'}"
			ondragover={(e) => {
				e.preventDefault();
				dragActive = true;
			}}
			ondragleave={() => (dragActive = false)}
			ondrop={onDrop}
			aria-label="Boundary upload"
		>
			<h2 class="mb-2 text-xl font-semibold text-slate-900">Upload a region boundary</h2>
			<p class="mb-6 text-sm leading-relaxed text-slate-500">
				A village, canal command, taluk or district polygon as
				<code class="rounded bg-slate-200 px-1.5 py-0.5 text-[0.85em]">.geojson</code>,
				<code class="rounded bg-slate-200 px-1.5 py-0.5 text-[0.85em]">.gpkg</code> or a shapefile
				<code class="rounded bg-slate-200 px-1.5 py-0.5 text-[0.85em]">.zip</code>. Every farm plot inside it
				is detected from satellite imagery, its crop identified, and the water need totalled.
			</p>
			<div class="flex flex-wrap items-center justify-center gap-2">
				<label
					class="inline-flex cursor-pointer items-center rounded-lg bg-blue-600 px-4 py-2.5 font-semibold text-white transition-colors hover:bg-blue-700"
				>
					<input
						type="file"
						accept=".geojson,.json,.gpkg,.zip,.shp,.shx,.dbf,.prj,.cpg"
						multiple
						onchange={onFileInput}
						disabled={reading}
						class="hidden"
					/>
					{reading ? 'Reading…' : 'Browse files'}
				</label>
				<label
					class="inline-flex cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 font-semibold text-slate-700 transition-colors hover:bg-slate-50"
				>
					<input type="file" webkitdirectory multiple onchange={onFileInput} disabled={reading} class="hidden" />
					Browse folder
				</label>
			</div>
			<p class="mt-4 text-xs text-slate-400">or drag and drop here</p>
		</section>
	{:else}
		<section class="mb-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4">
			<div class="min-w-0">
				<div class="truncate text-sm font-semibold text-slate-900">{boundary.name}</div>
				<div class="mt-0.5 text-xs text-slate-500">
					{boundary.polygons} polygon{boundary.polygons === 1 ? '' : 's'}
					{#if plan}
						· {plan.areaKm2.toLocaleString('en-IN')} km² · {fmt(plan.cells)} grid cells · {fmt(plan.cells)} API requests
						· {fmtDuration(plan.estimatedSeconds)}
					{:else if planning}
						· sizing…
					{/if}
				</div>
				{#if plan?.mode === 'summary'}
					<div class="mt-1 text-xs text-slate-500">
						Large area: results are totalled per grid cell. Click any cell on the map for its plot-level detail.
					</div>
				{/if}
			</div>
			<div class="flex shrink-0 items-center gap-2">
				<button
					type="button"
					onclick={reset}
					disabled={fetching}
					class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
				>
					Change boundary
				</button>
				{#if fetching}
					<button
						type="button"
						onclick={() => controller?.abort()}
						class="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-semibold text-red-600 hover:bg-red-50"
					>
						Stop
					</button>
				{:else}
					<button
						type="button"
						onclick={fetchRegion}
						disabled={!plan || !!planError || planning || !budgetCsv}
						class="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{hasResults ? 'Fetch again' : 'Detect crops & estimate water'}
					</button>
				{/if}
			</div>
		</section>

		{#if planError}
			<div class="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{planError}</div>
		{/if}

		{#if fetching}
			{@const pct = progress.total ? (progress.done / progress.total) * 100 : 0}
			<section class="mb-4 rounded-xl border border-slate-200 bg-white px-5 py-4">
				<div class="mb-2 flex items-baseline justify-between text-sm">
					<span class="font-semibold text-slate-800">Fetching plots and crop history…</span>
					<span class="tabular-nums text-slate-500">{fmt(progress.done)} / {fmt(progress.total)} cells</span>
				</div>
				<div class="h-2 overflow-hidden rounded-full bg-slate-100">
					<div class="h-full rounded-full bg-blue-600 transition-[width] duration-200" style="width: {pct}%"></div>
				</div>
				<p class="mt-2 text-xs text-slate-500">
					{fmt(progress.plots)} plots found{#if progress.failed} · {progress.failed} cells failed{/if}. Requests are paced
					to stay under the API limit of 5,000 per minute.
				</p>
			</section>
		{/if}

		{#if !fetching && (incomplete || progress.failed > 0) && hasResults}
			<div class="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
				{#if incomplete}
					Stopped after {fmt(progress.done)} of {fmt(progress.total)} grid cells; totals cover only part of the region.
				{:else}
					{progress.failed} of {fmt(progress.total)} grid cells could not be fetched{firstCellError ? ` (${firstCellError})` : ''}; their
					plots are missing from the totals. Fetch again to retry.
				{/if}
			</div>
		{/if}
	{/if}

	{#if summary && totals}
		<section class="mb-4 flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4">
			<label class="grid gap-1 text-xs font-medium text-slate-500">
				Season
				<select
					bind:value={seasonKey}
					class="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-900"
				>
					{#each seasons as s}
						<option value={s.key}>{s.label} · {fmt(s.plots)} plots</option>
					{/each}
				</select>
			</label>
			<label class="grid gap-1 text-xs font-medium text-slate-500">
				Crop confidence
				<select
					bind:value={minConfidence}
					class="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-900"
				>
					{#each CONFIDENCE_OPTIONS as o}
						<option value={o.value}>{o.label}</option>
					{/each}
				</select>
			</label>
			<label class="grid gap-1 text-xs font-medium text-slate-500">
				Sowing date
				<div class="flex items-center gap-1.5">
					<input
						type="date"
						bind:value={sowingDate}
						class="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm font-medium text-slate-900"
					/>
					{#if sowingDate}
						<button type="button" class="text-xs font-semibold text-blue-600 hover:underline" onclick={() => (sowingDate = '')}>
							Reset
						</button>
					{/if}
				</div>
			</label>
			<p class="min-w-[16rem] flex-1 text-xs leading-relaxed text-slate-400">
				Crops come from Google's crop monitoring for the chosen season. Without a sowing date, each plot's water schedule
				starts in the month its crop was first detected.
			</p>
		</section>

		<SummaryStats {totals} {seasonKey} />

		{#if processed}
			<PlotsPanel
				{processed}
				boundary={boundary?.featureCollection ?? null}
				exportName={boundary?.name ?? 'region'}
				{seasonKey}
				tableName={TABLE_NAME}
				onError={(m) => (error = m)}
			/>
		{:else if cellSummary}
			<div class="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
				<p class="text-sm text-slate-600">
					<span class="font-semibold text-slate-800">{fmt(cellSummary.cells.length)} grid cells</span> shaded by water need.
					Click a cell to load its plots.
				</p>
				<div class="relative" bind:this={exportMenuRef}>
					<button
						type="button"
						class="inline-flex items-center gap-1.5 rounded-lg border border-blue-600 bg-blue-600/10 px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-600/20"
						onclick={(e) => {
							e.stopPropagation();
							exportMenuOpen = !exportMenuOpen;
						}}
					>
						Export
						<svg class="h-4 w-4 transition-transform {exportMenuOpen ? 'rotate-180' : ''}" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
							<path
								fill-rule="evenodd"
								d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.25a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
								clip-rule="evenodd"
							/>
						</svg>
					</button>
					{#if exportMenuOpen}
						{@const name = boundary?.name ?? 'region'}
						<div class="absolute right-0 z-[1000] mt-1 min-w-[15rem] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
							<button type="button" class="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50" onclick={() => runExport(() => downloadCropSummaryCsv(cellSummary, name, seasonKey))}>
								Crop summary (CSV)
							</button>
							<button type="button" class="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50" onclick={() => runExport(() => downloadCellsCsv(cellSummary, name, seasonKey))}>
								Grid cells with monthly water (CSV)
							</button>
							<button type="button" class="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50" onclick={() => runExport(() => downloadCellsGeojson(cellSummary, name, seasonKey))}>
								Grid cells with geometry (GeoJSON)
							</button>
						</div>
					{/if}
				</div>
			</div>

			<div class="relative">
				<CellSummaryMap
					cells={cellSummary.cells}
					boundary={boundary?.featureCollection ?? null}
					selectedId={selectedCell}
					onSelect={selectCell}
				/>
				{#if selectedTotals}
					<div class="absolute right-3 top-3 z-[500] w-64 rounded-lg border border-slate-200 bg-white/95 p-3 text-xs shadow">
						<div class="mb-1 flex items-center justify-between">
							<span class="font-semibold text-slate-800">Selected grid cell</span>
							<button type="button" class="text-slate-400 hover:text-slate-700" aria-label="Clear selection" onclick={() => selectCell(null)}>✕</button>
						</div>
						<div class="text-lg font-bold text-sky-700">{fmt(selectedTotals.m3)} m³</div>
						<div class="text-slate-500">{fmtAcres(selectedTotals.acres)} ac of farm plots · {fmt(selectedTotals.plots)} plots</div>
						<button
							type="button"
							class="mt-2 w-full rounded-md bg-blue-600 px-2 py-1.5 font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
							disabled={cellLoading}
							onclick={() => cellSection?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
						>
							{cellLoading ? 'Loading plots…' : 'View plot-level detail ↓'}
						</button>
					</div>
				{/if}
			</div>

			{#if selectedCell}
				<section bind:this={cellSection} class="mt-6 scroll-mt-4 rounded-2xl border border-blue-200 bg-blue-50/40 p-4">
					<div class="mb-3 flex items-center justify-between">
						<h3 class="text-base font-semibold text-slate-900">Plot-level detail · grid cell {selectedCell}</h3>
						<button type="button" class="text-sm font-semibold text-slate-500 hover:text-slate-800" onclick={() => selectCell(null)}>
							Close
						</button>
					</div>
					{#if cellLoading}
						<p class="text-sm text-slate-500">Loading plots for this cell…</p>
					{:else if cellError}
						<p class="text-sm text-red-700">{cellError}</p>
					{:else if detailProcessed && detailSummary && detailTotals}
						<SummaryStats totals={detailTotals} {seasonKey} />
						<PlotsPanel
							processed={detailProcessed}
							boundary={detailBoundary}
							exportName={`${(boundary?.name ?? 'region').replace(/\.[^.]+$/, '')}_cell_${selectedCell}`}
							{seasonKey}
							tableName={TABLE_NAME}
							onError={(m) => (error = m)}
						/>
						<SummaryTables summary={detailSummary} totals={detailTotals} title={`grid cell · ${seasonKey}`} cropColors={cropColorMap(detailSummary.rows.map((r) => r.crop))} />
					{/if}
				</section>
			{/if}
		{/if}

		<SummaryTables {summary} {totals} title={`${boundary?.name ?? 'region'} · ${seasonKey}`} {cropColors} />
	{/if}
</div>
