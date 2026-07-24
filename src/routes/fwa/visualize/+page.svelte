<script lang="ts">
	import { onMount } from 'svelte';
	import {
		enrichFeatureCollection,
		getGpkgColumnNames,
		guessDefaultColumns,
		parseGpkgFile,
		type ParseOptions,
		type ProcessedGeoJson
	} from '$lib/gpkgParser';
	import {
		collectDroppedFiles,
		loadShapefileFromFiles,
		looksLikeShapefileInput
	} from '$lib/shapefileImport';
	import { downloadGpkg, exportGpkgWithWaterData, waterExportFileName } from '$lib/gpkgExporter';
	import { downloadCsv } from '$lib/csvExporter';
	import { downloadPdf } from '$lib/pdfExporter';
	import type { CropSeason } from '$lib/waterBudget';
	import { configureGeoPackage } from '$lib/setupGeopackage';
	import { getGroupableColumns, type ViewMode } from '$lib/groupUtils';
	import FarmMap from '$lib/components/FarmMap.svelte';

	onMount(() => {
		configureGeoPackage();

		const closeExportMenu = (event: MouseEvent) => {
			if (exportMenuRef && !exportMenuRef.contains(event.target as Node)) {
				exportMenuOpen = false;
			}
		};
		document.addEventListener('click', closeExportMenu);
		return () => document.removeEventListener('click', closeExportMenu);
	});

	let selectedFeature = $state<GeoJSON.Feature | null>(null);
	let geojson = $state<ProcessedGeoJson | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let fileName = $state<string | null>(null);
	let featureCount = $state(0);
	/** Raw GPKG bytes (when source is GeoPackage) */
	let fileBuffer = $state<ArrayBuffer | null>(null);
	/** Parsed shapefile FeatureCollection awaiting column mapping */
	let pendingShapefile = $state<GeoJSON.FeatureCollection | null>(null);
	let pendingTableName = $state('farm_plots');
	let sourceKind = $state<'gpkg' | 'shapefile' | null>(null);
	let availableColumns = $state<string[]>([]);
	let cropColumn = $state('');
	let sowingDateColumn = $state('');
	let fallbackSeason = $state<CropSeason | ''>('');
	let acresColumn = $state('');
	let defaultAcres = $state('1');
	let showColumnConfig = $state(false);
	let dragActive = $state(false);
	let tableName = $state('');
	let exporting = $state(false);
	let exportMenuOpen = $state(false);
	let exportMenuRef = $state<HTMLDivElement | null>(null);

	/** Dashboard: individual plot / group / sub-group / farm-wide */
	let viewMode = $state<ViewMode>('plot');
	let groupByColumn = $state('');
	let subGroupByColumn = $state('');
	let selectedGroup = $state<string | null>(null);
	let selectedSubGroup = $state<string | null>(null);

	const useSeasonFallback = $derived(!sowingDateColumn);
	const useDefaultAcres = $derived(!acresColumn);
	const groupableColumns = $derived(geojson ? getGroupableColumns(geojson.features) : []);

	const fieldClass =
		'rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-slate-900 disabled:opacity-60';
	const labelClass = 'grid gap-1.5 text-sm text-slate-700';

	async function loadBudgetCsv(): Promise<string> {
		const budgetResponse = await fetch('/total_water_needed.csv');
		if (!budgetResponse.ok) {
			throw new Error('Could not load total_water_needed.csv');
		}
		return budgetResponse.text();
	}

	function resetForNewUpload(displayName: string) {
		selectedFeature = null;
		selectedGroup = null;
		selectedSubGroup = null;
		geojson = null;
		featureCount = 0;
		tableName = '';
		groupByColumn = '';
		subGroupByColumn = '';
		viewMode = 'plot';
		fileName = displayName;
		showColumnConfig = false;
		fileBuffer = null;
		pendingShapefile = null;
		sourceKind = null;
		error = null;
	}

	function applyColumnDefaults(columns: string[]) {
		const defaults = guessDefaultColumns(columns);
		availableColumns = columns;
		cropColumn = defaults.cropColumn;
		sowingDateColumn = defaults.sowingDateColumn;
		acresColumn = defaults.acresColumn;
		fallbackSeason = defaults.sowingDateColumn ? '' : 'Kharif';
		defaultAcres = '1';
		showColumnConfig = true;
	}

	async function processFile(options: ParseOptions) {
		if (sourceKind === 'gpkg' && !fileBuffer) return;
		if (sourceKind === 'shapefile' && !pendingShapefile) return;

		loading = true;
		error = null;
		selectedFeature = null;
		selectedGroup = null;
		selectedSubGroup = null;

		try {
			const budgetCsv = await loadBudgetCsv();
			let processed: ProcessedGeoJson;

			if (sourceKind === 'shapefile' && pendingShapefile) {
				processed = enrichFeatureCollection(
					pendingShapefile,
					pendingTableName,
					budgetCsv,
					options
				);
			} else if (fileBuffer) {
				processed = await parseGpkgFile(fileBuffer, budgetCsv, options);
			} else {
				throw new Error('No data source loaded.');
			}

			geojson = processed;
			featureCount = processed.features.length;
			tableName = processed.tableName;
			showColumnConfig = false;
			const cols = getGroupableColumns(processed.features);
			groupByColumn = cols.includes('crop') ? 'crop' : cols[0] ?? '';
			// Prefer crop as Then-by when Group by is something else (e.g. lateral)
			subGroupByColumn =
				groupByColumn && groupByColumn !== 'crop' && cols.includes('crop')
					? 'crop'
					: cols.find((c) => c !== groupByColumn) ?? '';
			viewMode = 'overall';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to process data.';
			geojson = null;
			featureCount = 0;
			groupByColumn = '';
			subGroupByColumn = '';
		} finally {
			loading = false;
		}
	}

	async function loadGpkg(file: File) {
		loading = true;
		resetForNewUpload(file.name);

		try {
			const buffer = await file.arrayBuffer();
			const columns = await getGpkgColumnNames(buffer);
			fileBuffer = buffer;
			sourceKind = 'gpkg';
			pendingTableName = 'farm_plots';
			applyColumnDefaults(columns);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to read GeoPackage file.';
			fileBuffer = null;
			availableColumns = [];
		} finally {
			loading = false;
		}
	}

	async function loadShapefile(files: File[]) {
		loading = true;
		resetForNewUpload(files.length === 1 ? files[0].name : `${files.length} shapefile files`);

		try {
			const result = await loadShapefileFromFiles(files);
			pendingShapefile = result.featureCollection;
			pendingTableName = result.tableName;
			sourceKind = 'shapefile';
			fileName = result.displayName;
			applyColumnDefaults(result.columns);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to read shapefile.';
			pendingShapefile = null;
			availableColumns = [];
		} finally {
			loading = false;
		}
	}

	async function loadInputs(files: File[]) {
		if (files.length === 0) return;

		const list = Array.from(files);
		const onlyGpkg =
			list.length === 1 && list[0].name.toLowerCase().endsWith('.gpkg');

		if (onlyGpkg) {
			await loadGpkg(list[0]);
			return;
		}

		if (looksLikeShapefileInput(list)) {
			await loadShapefile(list);
			return;
		}

		const gpkg = list.find((f) => f.name.toLowerCase().endsWith('.gpkg'));
		if (gpkg) {
			await loadGpkg(gpkg);
			return;
		}

		error =
			'Unsupported input. Upload a .gpkg, a shapefile zip, or a folder with .shp/.dbf/.prj/.cpg/.qmd.';
	}

	function handleFileUpload(event: Event) {
		const input = event.target as HTMLInputElement;
		const files = input.files ? Array.from(input.files) : [];
		if (files.length) loadInputs(files);
		input.value = '';
	}

	function handleFolderUpload(event: Event) {
		const input = event.target as HTMLInputElement;
		const files = input.files ? Array.from(input.files) : [];
		if (files.length) loadInputs(files);
		input.value = '';
	}

	function handleDragOver(event: DragEvent) {
		event.preventDefault();
		dragActive = true;
	}

	function handleDragLeave(event: DragEvent) {
		event.preventDefault();
		dragActive = false;
	}

	async function handleDrop(event: DragEvent) {
		event.preventDefault();
		dragActive = false;
		if (!event.dataTransfer) return;
		const files = await collectDroppedFiles(event.dataTransfer);
		await loadInputs(files);
	}

	async function applyColumnMapping() {
		if (!cropColumn) {
			error = 'Select a crop column before loading the map.';
			return;
		}

		if (!sowingDateColumn && !fallbackSeason) {
			error = 'Select a sowing date column or choose Kharif/Rabi as fallback.';
			return;
		}

		const parsedDefaultAcres = Number.parseFloat(defaultAcres);
		if (!acresColumn && !(Number.isFinite(parsedDefaultAcres) && parsedDefaultAcres > 0)) {
			error = 'Enter a default area in acres greater than 0.';
			return;
		}

		await processFile({
			cropColumn,
			sowingDateColumn,
			fallbackSeason: sowingDateColumn ? '' : fallbackSeason,
			acresColumn,
			defaultAcres: Number.parseFloat(defaultAcres)
		});
	}

	async function handleExport(type: 'gpkg' | 'csv' | 'pdf') {
		if (!geojson || !tableName) return;

		exportMenuOpen = false;
		exporting = true;
		error = null;

		try {
			if (type === 'gpkg') {
				const bytes = await exportGpkgWithWaterData(geojson, tableName);
				downloadGpkg(bytes, waterExportFileName(fileName));
			} else if (type === 'csv') {
				downloadCsv(geojson, fileName);
			} else {
				await downloadPdf(geojson, fileName);
			}
		} catch (err) {
			error =
				err instanceof Error
					? err.message
					: `Failed to export ${type.toUpperCase()}.`;
		} finally {
			exporting = false;
		}
	}
</script>

<main
	class="mx-auto max-w-7xl p-6 {!geojson && !showColumnConfig
		? 'flex min-h-screen flex-col'
		: ''}"
>
	<header class="my-4 pb-4">
		<h1 class="mb-1.5 text-3xl font-semibold text-slate-900">Visualization Tool</h1>
		<p class="text-slate-500">
			Upload a GeoPackage or shapefile folder to visualize farm plots and monthly water
			requirements by crop.
		</p>
	</header>

	{#if error}
		<div class="mb-4 rounded-lg bg-red-100 px-4 py-3 text-red-800">{error}</div>
	{/if}

	{#if !geojson && !showColumnConfig}
		<div class="flex flex-1 items-center justify-center md:-translate-y-6 lg:-translate-y-10">
			<section
				class="w-full max-w-xl rounded-xl border-2 border-dashed bg-white p-8 text-center transition-colors {dragActive
					? 'border-blue-600 bg-blue-50'
					: 'border-slate-300'}"
				ondragover={handleDragOver}
				ondragleave={handleDragLeave}
				ondrop={handleDrop}
				aria-label="GeoPackage upload"
			>
			<h2 class="mb-3 text-xl font-semibold text-slate-900">Get started</h2>
			<p class="mb-6 text-[0.95rem] leading-relaxed text-slate-500">
				Upload a <code class="rounded bg-slate-200 px-1.5 py-0.5 text-[0.85em]">.gpkg</code>, a
				shapefile <code class="rounded bg-slate-200 px-1.5 py-0.5 text-[0.85em]">.zip</code>, or a
				folder with
				<code class="rounded bg-slate-200 px-1.5 py-0.5 text-[0.85em]">.shp</code>,
				<code class="rounded bg-slate-200 px-1.5 py-0.5 text-[0.85em]">.dbf</code>,
				<code class="rounded bg-slate-200 px-1.5 py-0.5 text-[0.85em]">.prj</code>,
				<code class="rounded bg-slate-200 px-1.5 py-0.5 text-[0.85em]">.cpg</code>,
				<code class="rounded bg-slate-200 px-1.5 py-0.5 text-[0.85em]">.qmd</code>
				(and related sidecars). Then map crop / sowing / area columns and load the map.
			</p>

			<div class="grid justify-items-center gap-3 border-t border-slate-200 pt-5">
				<p class="text-lg text-slate-700">
					Drag and drop a <code class="rounded bg-slate-200 px-1.5 py-0.5 text-[0.85em]">.gpkg</code>,
					shapefile zip, or folder here
				</p>
				<p class="text-sm text-slate-400">or</p>
				<div class="flex flex-wrap items-center justify-center gap-2">
					<label
						class="inline-flex cursor-pointer items-center rounded-lg bg-blue-600 px-4 py-2.5 font-semibold text-white transition-colors hover:bg-blue-700"
					>
						<input
							type="file"
							accept=".gpkg,.GPKG,.zip,.shp,.dbf,.prj,.cpg,.qmd,.shx"
							multiple
							onchange={handleFileUpload}
							disabled={loading}
							class="hidden"
						/>
						{loading ? 'Reading…' : 'Browse files'}
					</label>
					<label
						class="inline-flex cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 font-semibold text-slate-700 transition-colors hover:bg-slate-50"
					>
						<input
							type="file"
							webkitdirectory
							multiple
							onchange={handleFolderUpload}
							disabled={loading}
							class="hidden"
						/>
						Browse folder
					</label>
				</div>
			</div>
		</section>
		</div>
	{/if}

	{#if fileName}
		<div class="mb-4 flex flex-wrap items-center justify-between gap-4">
			<div
				class="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3"
			>
				<div class="min-w-0">
					<div class="truncate text-sm font-semibold text-slate-900">{fileName}</div>
					{#if geojson}
						<div class="text-sm text-slate-500">{featureCount} plots</div>
					{/if}
				</div>
				<div class="flex shrink-0 gap-2">
					<label
						class="inline-flex cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
					>
						<input
							type="file"
							accept=".gpkg,.GPKG,.zip,.shp,.dbf,.prj,.cpg,.qmd,.shx"
							multiple
							onchange={handleFileUpload}
							disabled={loading}
							class="hidden"
						/>
						Change files
					</label>
					<label
						class="inline-flex cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
					>
						<input
							type="file"
							webkitdirectory
							multiple
							onchange={handleFolderUpload}
							disabled={loading}
							class="hidden"
						/>
						Change folder
					</label>
				</div>
			</div>

			{#if geojson}
				<div class="relative" bind:this={exportMenuRef}>
					<button
						type="button"
						class="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-blue-600 bg-blue-600/10 px-4 py-2 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-600/20 disabled:cursor-not-allowed disabled:opacity-60"
						onclick={(event) => {
							event.stopPropagation();
							exportMenuOpen = !exportMenuOpen;
						}}
						disabled={exporting || loading}
					>
						{exporting ? 'Exporting…' : 'Export'}
						<svg
							class="h-4 w-4 transition-transform {exportMenuOpen ? 'rotate-180' : ''}"
							viewBox="0 0 20 20"
							fill="currentColor"
							aria-hidden="true"
						>
							<path
								fill-rule="evenodd"
								d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.25a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
								clip-rule="evenodd"
							/>
						</svg>
					</button>

					{#if exportMenuOpen}
						<div
							class="absolute right-0 z-20 mt-1 min-w-[10rem] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
						>
							<button
								type="button"
								class="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
								onclick={() => handleExport('gpkg')}
								disabled={exporting}
							>
								Export GPKG
							</button>
							<button
								type="button"
								class="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
								onclick={() => handleExport('csv')}
								disabled={exporting}
							>
								Export CSV
							</button>
							<button
								type="button"
								class="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
								onclick={() => handleExport('pdf')}
								disabled={exporting}
							>
								Export PDF
							</button>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	{#if showColumnConfig && !geojson}
		<section class="mb-4 rounded-xl border border-slate-200 bg-white p-5">
			<h2 class="mb-1 text-lg font-semibold text-slate-900">Column mapping</h2>
			<p class="mb-4 text-sm text-slate-500">
				Map GeoPackage / shapefile columns to crop, sowing date, and area. Use fallbacks when a
				column is not in the file.
			</p>

			<div class="mb-4 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
				<label class={labelClass}>
					<span class="font-semibold">Crop column</span>
					<select bind:value={cropColumn} disabled={loading} class={fieldClass}>
						<option value="">Select column…</option>
						{#each availableColumns as column}
							<option value={column}>{column}</option>
						{/each}
					</select>
				</label>

				<label class={labelClass}>
					<span class="font-semibold">Sowing date column</span>
					<select bind:value={sowingDateColumn} disabled={loading} class={fieldClass}>
						<option value="">Not in file — use season fallback</option>
						{#each availableColumns as column}
							<option value={column}>{column}</option>
						{/each}
					</select>
				</label>

				{#if useSeasonFallback}
					<label class={labelClass}>
						<span class="font-semibold">Season fallback</span>
						<select bind:value={fallbackSeason} disabled={loading} class={fieldClass}>
							<option value="">Select season…</option>
							<option value="Kharif">Kharif</option>
							<option value="Rabi">Rabi</option>
						</select>
					</label>
				{/if}

				<label class={labelClass}>
					<span class="font-semibold">Acres column</span>
					<select bind:value={acresColumn} disabled={loading} class={fieldClass}>
						<option value="">Not in file — use default area</option>
						{#each availableColumns as column}
							<option value={column}>{column}</option>
						{/each}
					</select>
				</label>

				{#if useDefaultAcres}
					<label class={labelClass}>
						<span class="font-semibold">Default area (acres)</span>
						<input
							type="number"
							min="0.01"
							step="0.01"
							bind:value={defaultAcres}
							disabled={loading}
							placeholder="e.g. 1.5"
							class={fieldClass}
						/>
					</label>
				{/if}
			</div>

			<button
				class="cursor-pointer rounded-lg bg-blue-600 px-4 py-2.5 font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
				onclick={applyColumnMapping}
				disabled={loading || !cropColumn || (useSeasonFallback && !fallbackSeason)}
			>
				{loading ? 'Loading map…' : 'Load map'}
			</button>
		</section>
	{/if}

	{#if geojson}
		<!-- View mode + group-by controls -->
		<div
			class="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3"
		>
			<div class="flex flex-wrap items-center gap-2" role="tablist" aria-label="Dashboard view">
				{#each [
					{ id: 'plot' as ViewMode, label: 'Individual plots' },
					{ id: 'group' as ViewMode, label: 'Groups' },
					{ id: 'subgroup' as ViewMode, label: 'Sub-groups' },
					{ id: 'overall' as ViewMode, label: 'Overall' }
				] as tab}
					<button
						type="button"
						role="tab"
						aria-selected={viewMode === tab.id}
						class="rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors
						{viewMode === tab.id
							? 'bg-blue-600 text-white'
							: 'bg-slate-100 text-slate-600 hover:bg-slate-200'}"
						onclick={() => {
							viewMode = tab.id;
							if (tab.id === 'overall') {
								selectedFeature = null;
								selectedGroup = null;
								selectedSubGroup = null;
							} else if (tab.id === 'group') {
								selectedFeature = null;
								selectedSubGroup = null;
							} else if (tab.id === 'subgroup') {
								selectedFeature = null;
								selectedSubGroup = null;
							} else if (tab.id === 'plot') {
								selectedGroup = null;
								selectedSubGroup = null;
							}
						}}
					>
						{tab.label}
					</button>
				{/each}
			</div>

			<div class="flex flex-wrap items-center gap-3">
				<label class="flex items-center gap-2 text-sm text-slate-700">
					<span class="font-semibold">Group by</span>
					<select
						class="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900"
						value={groupByColumn}
						onchange={(e) => {
							groupByColumn = (e.target as HTMLSelectElement).value;
							selectedGroup = null;
							selectedSubGroup = null;
							if (subGroupByColumn === groupByColumn) {
								subGroupByColumn =
									groupableColumns.find((c) => c !== groupByColumn) ?? '';
							}
						}}
					>
						<option value="">None</option>
						{#each groupableColumns as col}
							<option value={col}>{col}</option>
						{/each}
					</select>
				</label>

				<label class="flex items-center gap-2 text-sm text-slate-700">
					<span class="font-semibold">Then by</span>
					<select
						class="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 disabled:opacity-50"
						value={subGroupByColumn}
						disabled={!groupByColumn}
						onchange={(e) => {
							subGroupByColumn = (e.target as HTMLSelectElement).value;
							selectedSubGroup = null;
						}}
					>
						<option value="">None</option>
						{#each groupableColumns.filter((c) => c !== groupByColumn) as col}
							<option value={col}>{col}</option>
						{/each}
					</select>
				</label>
			</div>
		</div>

		<FarmMap
			{geojson}
			{selectedFeature}
			{viewMode}
			{groupByColumn}
			{subGroupByColumn}
			{selectedGroup}
			{selectedSubGroup}
			onFeatureSelect={(feature) => {
				selectedFeature = feature;
				if (feature && viewMode === 'overall') {
					// Peeking a plot from overall keeps overall mode
				} else if (feature) {
					viewMode = 'plot';
				}
			}}
			onGroupSelect={(key) => {
				selectedGroup = key;
				selectedSubGroup = null;
				if (key) {
					if (viewMode === 'plot' || viewMode === 'overall') {
						viewMode = 'group';
					}
					selectedFeature = null;
				}
			}}
			onSubGroupSelect={(key) => {
				selectedSubGroup = key;
				if (key) {
					viewMode = 'subgroup';
					selectedFeature = null;
				}
			}}
		/>
	{/if}
</main>
