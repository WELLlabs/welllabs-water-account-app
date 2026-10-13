<script lang="ts">
	import { onMount } from 'svelte';
	import FarmMap from '$lib/components/FarmMap.svelte';
	import type { ProcessedGeoJson } from '$lib/gpkgParser';
	import type { ViewMode } from '$lib/groupUtils';
	import { downloadCsv } from '$lib/csvExporter';
	import { downloadPdf } from '$lib/pdfExporter';
	import { downloadGpkg, exportGpkgWithWaterData, waterExportFileName } from '$lib/gpkgExporter';
	import { downloadCropSummaryCsv, summarizeByCrop } from '$lib/regionBudget';
	import { fmt } from './format';

	interface Props {
		processed: ProcessedGeoJson;
		boundary: GeoJSON.FeatureCollection | null;
		/** Base name for exported files */
		exportName: string;
		seasonKey: string;
		tableName: string;
		/** Extra export entries rendered above the plot exports */
		extraExports?: { label: string; run: () => void | Promise<void> }[];
		onError: (message: string) => void;
	}

	let { processed, boundary, exportName, seasonKey, tableName, extraExports = [], onError }: Props = $props();

	/** One PDF page per plot; beyond this the plot PDF is impractically long */
	const MAX_PLOT_PDF = 200;

	let viewMode = $state<ViewMode>('overall');
	let selectedFeature = $state<GeoJSON.Feature | null>(null);
	let selectedGroup = $state<string | null>(null);
	let menuOpen = $state(false);
	let menuRef = $state<HTMLDivElement | null>(null);
	let exporting = $state(false);

	const plotPdfBlocked = $derived(viewMode === 'plot' && processed.features.length > MAX_PLOT_PDF);

	onMount(() => {
		const close = (event: MouseEvent) => {
			if (menuRef && !menuRef.contains(event.target as Node)) menuOpen = false;
		};
		document.addEventListener('click', close);
		return () => document.removeEventListener('click', close);
	});

	function setView(mode: ViewMode) {
		viewMode = mode;
		selectedFeature = null;
		if (mode !== 'group') selectedGroup = null;
	}

	async function run(task: () => void | Promise<void>) {
		menuOpen = false;
		exporting = true;
		try {
			await task();
		} catch (e) {
			onError(e instanceof Error ? e.message : 'Export failed.');
		} finally {
			exporting = false;
		}
	}

	const exports = $derived([
		...extraExports,
		{ label: 'Crop summary (CSV)', run: () => downloadCropSummaryCsv(summarizeByCrop(processed), exportName, seasonKey) },
		{ label: 'Plots with monthly water (CSV)', run: () => downloadCsv(processed, exportName) },
		{
			label: 'Plots with geometry (GPKG)',
			run: async () => downloadGpkg(await exportGpkgWithWaterData(processed, tableName), waterExportFileName(exportName))
		}
	]);
</script>

<div class="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
	<div class="flex flex-wrap gap-2" role="tablist" aria-label="Water budget view">
		{#each [{ id: 'overall', label: 'Overall' }, { id: 'group', label: 'Crop level' }, { id: 'plot', label: 'Individual plots' }] as tab}
			<button
				type="button"
				role="tab"
				aria-selected={viewMode === tab.id}
				onclick={() => setView(tab.id as ViewMode)}
				class="rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors
				{viewMode === tab.id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}"
			>
				{tab.label}
			</button>
		{/each}
	</div>

	<div class="relative" bind:this={menuRef}>
		<button
			type="button"
			class="inline-flex items-center gap-1.5 rounded-lg border border-blue-600 bg-blue-600/10 px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-600/20 disabled:opacity-60"
			onclick={(e) => {
				e.stopPropagation();
				menuOpen = !menuOpen;
			}}
			disabled={exporting}
		>
			{exporting ? 'Exporting…' : 'Export'}
			<svg class="h-4 w-4 transition-transform {menuOpen ? 'rotate-180' : ''}" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
				<path
					fill-rule="evenodd"
					d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.25a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
					clip-rule="evenodd"
				/>
			</svg>
		</button>
		{#if menuOpen}
			<div class="absolute right-0 z-[1000] mt-1 min-w-[15rem] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
				{#each exports as item}
					<button type="button" class="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50" onclick={() => run(item.run)}>
						{item.label}
					</button>
				{/each}
				<button
					type="button"
					class="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
					onclick={() => run(() => downloadPdf(processed, exportName, { viewMode, groupByColumn: 'crop' }))}
					disabled={plotPdfBlocked}
					title={plotPdfBlocked
						? `Plot PDFs are one page per plot; switch to Overall or Crop level for ${fmt(processed.features.length)} plots`
						: ''}
				>
					{viewMode === 'plot' ? 'Plot report' : viewMode === 'group' ? 'Crop level report' : 'Overall report'} (PDF)
				</button>
			</div>
		{/if}
	</div>
</div>

<FarmMap
	geojson={processed}
	{selectedFeature}
	{viewMode}
	groupByColumn="crop"
	subGroupByColumn=""
	{selectedGroup}
	selectedSubGroup={null}
	preferCanvas
	{boundary}
	onFeatureSelect={(feature) => {
		selectedFeature = feature;
		if (feature) viewMode = 'plot';
	}}
	onGroupSelect={(key) => {
		selectedGroup = key;
		if (key) {
			viewMode = 'group';
			selectedFeature = null;
		}
	}}
	onSubGroupSelect={() => {}}
/>
