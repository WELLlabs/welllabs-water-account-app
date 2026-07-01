<script lang="ts">
	import { onMount } from 'svelte';
	import {
		getGpkgColumnNames,
		guessDefaultColumns,
		parseGpkgFile,
		type ParseOptions,
		type ProcessedGeoJson
	} from '$lib/gpkgParser';
	import { downloadGpkg, exportGpkgWithWaterData, waterExportFileName } from '$lib/gpkgExporter';
	import { downloadCsv } from '$lib/csvExporter';
	import { downloadPdf } from '$lib/pdfExporter';
	import type { CropSeason } from '$lib/waterBudget';
	import { configureGeoPackage } from '$lib/setupGeopackage';
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
	let fileBuffer = $state<ArrayBuffer | null>(null);
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

	const useSeasonFallback = $derived(!sowingDateColumn);
	const useDefaultAcres = $derived(!acresColumn);

	const fieldClass =
		'rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-slate-900 disabled:opacity-60';
	const labelClass = 'grid gap-1.5 text-sm text-slate-700';

	async function loadBudgetCsv(): Promise<string> {
		const budgetResponse = await fetch('/farm_water_budget.csv');
		if (!budgetResponse.ok) {
			throw new Error('Could not load farm_water_budget.csv');
		}
		return budgetResponse.text();
	}

	async function processFile(options: ParseOptions) {
		if (!fileBuffer) return;

		loading = true;
		error = null;
		selectedFeature = null;

		try {
			const budgetCsv = await loadBudgetCsv();
			const processed = await parseGpkgFile(fileBuffer, budgetCsv, options);
			geojson = processed;
			featureCount = processed.features.length;
			tableName = processed.tableName;
			showColumnConfig = false;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to process GeoPackage file.';
			geojson = null;
			featureCount = 0;
		} finally {
			loading = false;
		}
	}

	async function loadFile(file: File) {
		if (!file.name.toLowerCase().endsWith('.gpkg')) {
			error = 'Please upload a .gpkg file.';
			return;
		}

		loading = true;
		error = null;
		selectedFeature = null;
		geojson = null;
		featureCount = 0;
		tableName = '';
		fileName = file.name;
		showColumnConfig = false;

		try {
			const buffer = await file.arrayBuffer();
			const columns = await getGpkgColumnNames(buffer);
			const defaults = guessDefaultColumns(columns);

			fileBuffer = buffer;
			availableColumns = columns;
			cropColumn = defaults.cropColumn;
			sowingDateColumn = defaults.sowingDateColumn;
			acresColumn = defaults.acresColumn;
			fallbackSeason = defaults.sowingDateColumn ? '' : 'Kharif';
			defaultAcres = '1';
			showColumnConfig = true;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to read GeoPackage file.';
			fileBuffer = null;
			availableColumns = [];
		} finally {
			loading = false;
		}
	}

	function handleFileUpload(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (file) loadFile(file);
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

	function handleDrop(event: DragEvent) {
		event.preventDefault();
		dragActive = false;
		const file = event.dataTransfer?.files?.[0];
		if (file) loadFile(file);
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
		<h1 class="mb-1.5 text-3xl font-semibold text-slate-900">Farm Water Accounting</h1>
		<p class="text-slate-500">
			Upload a GeoPackage to visualize farm plots and monthly water requirements by crop.
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
				Upload a <code class="rounded bg-slate-200 px-1.5 py-0.5 text-[0.85em]">.gpkg</code> file
				containing crop, sowing date, and area columns. After upload, choose column mappings or
				fallbacks, then load the map. Water requirements are calculated from
				<code class="rounded bg-slate-200 px-1.5 py-0.5 text-[0.85em]">farm_water_budget.csv</code>.
			</p>

			<div class="grid justify-items-center gap-3 border-t border-slate-200 pt-5">
				<p class="text-lg text-slate-700">
					Drag and drop your
					<code class="rounded bg-slate-200 px-1.5 py-0.5 text-[0.85em]">.gpkg</code> file here
				</p>
				<p class="text-sm text-slate-400">or</p>
				<label
					class="inline-flex cursor-pointer items-center rounded-lg bg-blue-600 px-4 py-2.5 font-semibold text-white transition-colors hover:bg-blue-700"
				>
					<input
						type="file"
						accept=".gpkg,.GPKG"
						onchange={handleFileUpload}
						disabled={loading}
						class="hidden"
					/>
					{loading ? 'Reading file…' : 'Browse files'}
				</label>
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
				<label
					class="inline-flex shrink-0 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
				>
					<input
						type="file"
						accept=".gpkg,.GPKG"
						onchange={handleFileUpload}
						disabled={loading}
						class="hidden"
					/>
					Change
				</label>
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
				Map GeoPackage columns to crop, sowing date, and area. Use fallbacks when a column is not in
				the file.
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
		<FarmMap
			{geojson}
			{selectedFeature}
			onFeatureSelect={(feature) => {
				selectedFeature = feature;
			}}
		/>
	{/if}
</main>
