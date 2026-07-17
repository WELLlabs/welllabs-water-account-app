<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { FarmFeatureProperties } from '$lib/gpkgParser';
	import { formatCalendarMonth, getExportableMonthNeeds, roundWaterValue } from '$lib/waterBudget';
	import {
		buildGroupStats,
		buildOverallStats,
		getGroupValue,
		styleForGroup,
		type GroupStats,
		type OverallStats,
		type ViewMode
	} from '$lib/groupUtils';

	interface Props {
		geojson: GeoJSON.FeatureCollection | null;
		selectedFeature: GeoJSON.Feature | null;
		onFeatureSelect: (feature: GeoJSON.Feature | null) => void;
		viewMode: ViewMode;
		groupByColumn: string;
		selectedGroup: string | null;
		onGroupSelect: (key: string | null) => void;
	}

	let {
		geojson,
		selectedFeature,
		onFeatureSelect,
		viewMode,
		groupByColumn,
		selectedGroup,
		onGroupSelect
	}: Props = $props();

	let mapContainer: HTMLDivElement;
	let map = $state<import('leaflet').Map | null>(null);
	let leafletModule = $state<typeof import('leaflet') | null>(null);
	let geoJsonLayer: import('leaflet').GeoJSON | null = null;

	const defaultStyle = {
		color: '#facc15',
		weight: 3,
		fillColor: '#facc15',
		fillOpacity: 0.45
	};

	const selectedStyle = {
		color: '#f472b6',
		weight: 4,
		fillColor: '#f472b6',
		fillOpacity: 0.65
	};

	const groupData = $derived.by(() => {
		if (!geojson || !groupByColumn) {
			return { groups: [] as GroupStats[], colorByKey: new Map<string, string>() };
		}
		return buildGroupStats(geojson.features, groupByColumn);
	});

	const overall = $derived.by((): OverallStats | null => {
		if (!geojson) return null;
		return buildOverallStats(geojson.features, groupData.groups.length);
	});

	const activeGroup = $derived(
		selectedGroup ? groupData.groups.find((g) => g.key === selectedGroup) ?? null : null
	);

	function featureStyle(feature: GeoJSON.Feature | undefined): import('leaflet').PathOptions {
		if (!feature?.properties) return defaultStyle;
		const props = feature.properties as FarmFeatureProperties;
		const fid = props.fid;

		if (groupByColumn && groupData.colorByKey.size > 0) {
			const key = getGroupValue(feature, groupByColumn);
			const color = groupData.colorByKey.get(key) ?? '#94a3b8';
			const isSelectedPlot =
				viewMode === 'plot' &&
				selectedFeature &&
				(selectedFeature.properties as FarmFeatureProperties)?.fid === fid;
			const isSelectedGroup = viewMode === 'group' && selectedGroup === key;
			const muted =
				viewMode === 'group' && selectedGroup !== null && selectedGroup !== key;
			return styleForGroup(color, {
				selected: isSelectedPlot || isSelectedGroup,
				muted
			});
		}

		const isSelected =
			selectedFeature &&
			(selectedFeature.properties as FarmFeatureProperties)?.fid === fid;
		return isSelected ? selectedStyle : defaultStyle;
	}

	onMount(async () => {
		leafletModule = await import('leaflet');
		map = leafletModule.map(mapContainer).setView([16.3, 76.77], 14);

		leafletModule
			.tileLayer(
				'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
				{
					maxZoom: 19,
					attribution:
						'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
				}
			)
			.addTo(map);
	});

	$effect(() => {
		if (!map || !leafletModule || !geojson) return;

		if (geoJsonLayer) {
			geoJsonLayer.remove();
			geoJsonLayer = null;
		}

		// Depend on groupByColumn / color map so layer rebuilds when grouping changes
		void groupByColumn;
		void groupData.colorByKey;

		geoJsonLayer = leafletModule
			.geoJSON(geojson, {
				style: (feature) => featureStyle(feature),
				onEachFeature: (feature, layer) => {
					layer.on('click', () => {
						if (viewMode === 'group' && groupByColumn) {
							const key = getGroupValue(feature, groupByColumn);
							onGroupSelect(selectedGroup === key ? null : key);
							onFeatureSelect(null);
						} else if (viewMode === 'overall') {
							// Stay on overall; still allow peeking a plot
							onFeatureSelect(feature);
						} else {
							onFeatureSelect(feature);
							onGroupSelect(null);
						}
					});
				}
			})
			.addTo(map);

		const bounds = geoJsonLayer.getBounds();
		if (bounds.isValid()) {
			map.fitBounds(bounds, { padding: [24, 24] });
		}
	});

	$effect(() => {
		if (!geoJsonLayer || !leafletModule) return;
		void selectedFeature;
		void selectedGroup;
		void viewMode;
		void groupByColumn;
		geoJsonLayer.setStyle((feature) => featureStyle(feature));
	});

	onDestroy(() => {
		map?.remove();
	});

	function featureProps(feature: GeoJSON.Feature): FarmFeatureProperties {
		return feature.properties as FarmFeatureProperties;
	}
</script>

<div
	class="grid h-[calc(100vh-180px)] grid-cols-1 overflow-hidden rounded-xl border border-slate-200 bg-white max-[900px]:h-auto max-[900px]:grid-cols-1 min-[901px]:grid-cols-[1fr_380px]"
>
	<div class="relative min-h-[400px] max-[900px]:h-[50vh]">
		<div bind:this={mapContainer} class="h-full w-full"></div>

		<!-- Colour legend when grouping -->
		{#if groupByColumn && groupData.groups.length > 0}
			<div
				class="pointer-events-auto absolute bottom-3 left-3 max-h-[40%] max-w-[220px] overflow-y-auto rounded-lg border border-slate-200 bg-white/95 p-2.5 shadow backdrop-blur-sm"
			>
				<p class="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
					{groupByColumn}
				</p>
				<ul class="space-y-1">
					{#each groupData.groups as g}
						<li>
							<button
								type="button"
								class="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-slate-50
								{selectedGroup === g.key ? 'bg-slate-100 font-semibold' : ''}"
								onclick={() => {
									if (viewMode !== 'group') return;
									onGroupSelect(selectedGroup === g.key ? null : g.key);
								}}
							>
								<span
									class="h-3 w-3 shrink-0 rounded-sm border border-black/10"
									style="background:{g.color}"
								></span>
								<span class="min-w-0 truncate text-slate-700">{g.label}</span>
								<span class="ml-auto shrink-0 text-slate-400">{g.plotCount}</span>
							</button>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</div>

	<aside
		class="overflow-y-auto border-slate-200 bg-slate-50 p-5 min-[901px]:border-l max-[900px]:border-t"
	>
		<!-- ─── Overall dashboard ─────────────────────────────────────────── -->
		{#if viewMode === 'overall' && overall}
			<h2 class="mb-4 text-xl font-semibold text-slate-900">Overall summary</h2>
			<div class="mb-4 grid grid-cols-2 gap-2">
				<div class="rounded-lg bg-white p-3 shadow-sm">
					<p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Plots</p>
					<p class="text-xl font-semibold text-slate-900">{overall.plotCount}</p>
				</div>
				<div class="rounded-lg bg-white p-3 shadow-sm">
					<p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Total area</p>
					<p class="text-xl font-semibold text-slate-900">{overall.totalAcres.toFixed(2)} <span class="text-sm font-normal text-slate-500">ac</span></p>
				</div>
				<div class="rounded-lg bg-white p-3 shadow-sm">
					<p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Water needed</p>
					<p class="text-xl font-semibold text-slate-900">{overall.totalWaterM3.toFixed(0)} <span class="text-sm font-normal text-slate-500">m³</span></p>
				</div>
				<div class="rounded-lg bg-white p-3 shadow-sm">
					<p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Per acre</p>
					<p class="text-xl font-semibold text-slate-900">{overall.totalWaterM3PerAcre.toFixed(1)} <span class="text-sm font-normal text-slate-500">m³</span></p>
				</div>
			</div>
			<p class="mb-3 text-xs text-slate-500">
				{overall.matchedCount} of {overall.plotCount} plots matched a water budget
				{#if groupByColumn && overall.groupCount > 0}
					· {overall.groupCount} group{overall.groupCount === 1 ? '' : 's'} by {groupByColumn}
				{/if}
			</p>

			{#if overall.monthlyNeeds.length > 0}
				<section class="mt-2">
					<h3 class="mb-2 text-base font-semibold text-slate-800">Monthly water (all plots)</h3>
					<div class="overflow-hidden rounded-lg bg-white shadow-sm">
						<table class="w-full border-collapse text-sm">
							<thead>
								<tr>
									<th class="border-b border-slate-200 bg-blue-50 px-3 py-2 text-left font-semibold text-blue-800">Month</th>
									<th class="border-b border-slate-200 bg-blue-50 px-3 py-2 text-right font-semibold text-blue-800">m³/acre</th>
									<th class="border-b border-slate-200 bg-blue-50 px-3 py-2 text-right font-semibold text-blue-800">Total m³</th>
								</tr>
							</thead>
							<tbody>
								{#each overall.monthlyNeeds as need}
									<tr>
										<td class="border-b border-slate-200 px-3 py-2">{formatCalendarMonth(need.calendarMonth, need.calendarYear)}</td>
										<td class="border-b border-slate-200 px-3 py-2 text-right">{need.waterM3PerAcre.toFixed(2)}</td>
										<td class="border-b border-slate-200 px-3 py-2 text-right">{need.waterM3.toFixed(2)}</td>
									</tr>
								{/each}
							</tbody>
							<tfoot>
								<tr>
									<th class="border-t-2 border-slate-300 bg-slate-50 px-3 py-2 text-left">Total</th>
									<td class="border-t-2 border-slate-300 bg-slate-50 px-3 py-2 text-right font-semibold">{overall.totalWaterM3PerAcre.toFixed(2)}</td>
									<td class="border-t-2 border-slate-300 bg-slate-50 px-3 py-2 text-right font-semibold">{overall.totalWaterM3.toFixed(2)}</td>
								</tr>
							</tfoot>
						</table>
					</div>
				</section>
			{/if}

			{#if groupByColumn && groupData.groups.length > 0}
				<section class="mt-5">
					<h3 class="mb-2 text-base font-semibold text-slate-800">By {groupByColumn}</h3>
					<div class="space-y-1.5">
						{#each groupData.groups as g}
							<button
								type="button"
								class="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm hover:border-slate-300"
								onclick={() => onGroupSelect(g.key)}
							>
								<span class="h-3 w-3 shrink-0 rounded-sm" style="background:{g.color}"></span>
								<span class="min-w-0 flex-1 truncate font-medium text-slate-800">{g.label}</span>
								<span class="shrink-0 text-xs text-slate-500">{g.plotCount} · {g.totalWaterM3.toFixed(0)} m³</span>
							</button>
						{/each}
					</div>
					<p class="mt-2 text-xs text-slate-400">Switch to Groups view to explore a group in detail.</p>
				</section>
			{/if}

		<!-- ─── Group dashboard ───────────────────────────────────────────── -->
		{:else if viewMode === 'group'}
			{#if !groupByColumn}
				<div class="text-slate-500">
					<h2 class="mb-4 text-xl font-semibold text-slate-700">Groups</h2>
					<p>Choose a <strong>Group by</strong> column above to colour plots and aggregate water by group.</p>
				</div>
			{:else if activeGroup}
				<div class="mb-4 flex items-start gap-3">
					<span class="mt-1 h-4 w-4 shrink-0 rounded" style="background:{activeGroup.color}"></span>
					<div class="min-w-0">
						<p class="text-xs font-semibold uppercase tracking-wide text-slate-500">{groupByColumn}</p>
						<h2 class="truncate text-xl font-semibold text-slate-900">{activeGroup.label}</h2>
					</div>
				</div>

				<div class="mb-4 grid grid-cols-2 gap-2">
					<div class="rounded-lg bg-white p-3 shadow-sm">
						<p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Plots</p>
						<p class="text-xl font-semibold text-slate-900">{activeGroup.plotCount}</p>
					</div>
					<div class="rounded-lg bg-white p-3 shadow-sm">
						<p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Total area</p>
						<p class="text-xl font-semibold text-slate-900">{activeGroup.totalAcres.toFixed(2)} <span class="text-sm font-normal text-slate-500">ac</span></p>
					</div>
					<div class="rounded-lg bg-white p-3 shadow-sm">
						<p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Water needed</p>
						<p class="text-xl font-semibold text-slate-900">{activeGroup.totalWaterM3.toFixed(0)} <span class="text-sm font-normal text-slate-500">m³</span></p>
					</div>
					<div class="rounded-lg bg-white p-3 shadow-sm">
						<p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Per acre</p>
						<p class="text-xl font-semibold text-slate-900">{activeGroup.totalWaterM3PerAcre.toFixed(1)} <span class="text-sm font-normal text-slate-500">m³</span></p>
					</div>
				</div>

				{#if activeGroup.crops.length > 0}
					<p class="mb-3 text-sm text-slate-600">
						Crops: <strong>{activeGroup.crops.join(', ')}</strong>
					</p>
				{/if}

				{#if activeGroup.monthlyNeeds.length > 0}
					<section>
						<h3 class="mb-2 text-base font-semibold text-slate-800">Monthly water (group)</h3>
						<div class="overflow-hidden rounded-lg bg-white shadow-sm">
							<table class="w-full border-collapse text-sm">
								<thead>
									<tr>
										<th class="border-b border-slate-200 bg-blue-50 px-3 py-2 text-left font-semibold text-blue-800">Month</th>
										<th class="border-b border-slate-200 bg-blue-50 px-3 py-2 text-right font-semibold text-blue-800">m³/acre</th>
										<th class="border-b border-slate-200 bg-blue-50 px-3 py-2 text-right font-semibold text-blue-800">Total m³</th>
									</tr>
								</thead>
								<tbody>
									{#each activeGroup.monthlyNeeds as need}
										<tr>
											<td class="border-b border-slate-200 px-3 py-2">{formatCalendarMonth(need.calendarMonth, need.calendarYear)}</td>
											<td class="border-b border-slate-200 px-3 py-2 text-right">{need.waterM3PerAcre.toFixed(2)}</td>
											<td class="border-b border-slate-200 px-3 py-2 text-right">{need.waterM3.toFixed(2)}</td>
										</tr>
									{/each}
								</tbody>
								<tfoot>
									<tr>
										<th class="border-t-2 border-slate-300 bg-slate-50 px-3 py-2 text-left">Total</th>
										<td class="border-t-2 border-slate-300 bg-slate-50 px-3 py-2 text-right font-semibold">{activeGroup.totalWaterM3PerAcre.toFixed(2)}</td>
										<td class="border-t-2 border-slate-300 bg-slate-50 px-3 py-2 text-right font-semibold">{activeGroup.totalWaterM3.toFixed(2)}</td>
									</tr>
								</tfoot>
							</table>
						</div>
					</section>
				{:else}
					<p class="rounded-lg bg-amber-100 px-3 py-3 text-sm text-amber-800">
						No matched water budgets in this group.
					</p>
				{/if}

				<button
					type="button"
					class="mt-4 text-sm font-semibold text-blue-600 hover:text-blue-800"
					onclick={() => onGroupSelect(null)}
				>
					← All groups
				</button>
			{:else}
				<h2 class="mb-1 text-xl font-semibold text-slate-900">Groups by {groupByColumn}</h2>
				<p class="mb-4 text-sm text-slate-500">
					Click a group below or a coloured plot on the map. Water is summed across all plots in the group.
				</p>
				<div class="space-y-2">
					{#each groupData.groups as g}
						<button
							type="button"
							class="w-full rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition-colors hover:border-slate-300"
							onclick={() => onGroupSelect(g.key)}
						>
							<div class="mb-2 flex items-center gap-2">
								<span class="h-3.5 w-3.5 shrink-0 rounded" style="background:{g.color}"></span>
								<span class="min-w-0 flex-1 truncate font-semibold text-slate-900">{g.label}</span>
							</div>
							<div class="grid grid-cols-3 gap-2 text-xs text-slate-600">
								<span>{g.plotCount} plot{g.plotCount === 1 ? '' : 's'}</span>
								<span>{g.totalAcres.toFixed(1)} ac</span>
								<span class="text-right font-medium text-slate-800">{g.totalWaterM3.toFixed(0)} m³</span>
							</div>
						</button>
					{/each}
				</div>
			{/if}

		<!-- ─── Individual plot dashboard ─────────────────────────────────── -->
		{:else if selectedFeature}
			{@const p = featureProps(selectedFeature)}
			<h2 class="mb-4 text-xl font-semibold text-slate-900">Farm Plot Details</h2>

			{#if groupByColumn}
				{@const gKey = getGroupValue(selectedFeature, groupByColumn)}
				{@const gColor = groupData.colorByKey.get(gKey)}
				<div class="mb-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
					{#if gColor}
						<span class="h-3 w-3 rounded-sm" style="background:{gColor}"></span>
					{/if}
					<span class="text-slate-500">{groupByColumn}:</span>
					<span class="font-medium text-slate-800">{gKey}</span>
				</div>
			{/if}

			<dl class="grid gap-3">
				{#if p.FarmerName}
					<div class="grid grid-cols-[110px_1fr] gap-2">
						<dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Farmer</dt>
						<dd class="text-slate-900">{p.FarmerName}</dd>
					</div>
				{/if}
				{#if p.Village}
					<div class="grid grid-cols-[110px_1fr] gap-2">
						<dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Village</dt>
						<dd class="text-slate-900">{p.Village}</dd>
					</div>
				{/if}
				{#if p.UniqueId}
					<div class="grid grid-cols-[110px_1fr] gap-2">
						<dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Plot ID</dt>
						<dd class="text-slate-900">{p.UniqueId}</dd>
					</div>
				{/if}
				{#if p.crop}
					<div class="grid grid-cols-[110px_1fr] gap-2">
						<dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Crop</dt>
						<dd class="text-slate-900">{p.crop}</dd>
					</div>
				{/if}
				{#if p.sowingDate}
					<div class="grid grid-cols-[110px_1fr] gap-2">
						<dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Sowing Date</dt>
						<dd class="text-slate-900">{p.sowingDate}</dd>
					</div>
				{:else if p.waterSchedule?.season}
					<div class="grid grid-cols-[110px_1fr] gap-2">
						<dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Season</dt>
						<dd class="text-slate-900">{p.waterSchedule.season} (from fallback)</dd>
					</div>
				{/if}
				{#if p.acres}
					<div class="grid grid-cols-[110px_1fr] gap-2">
						<dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Area</dt>
						<dd class="text-slate-900">{p.acres.toFixed(2)} acres</dd>
					</div>
				{/if}
				{#if p.IR_Status}
					<div class="grid grid-cols-[110px_1fr] gap-2">
						<dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">IR Status</dt>
						<dd class="text-slate-900">{p.IR_Status}</dd>
					</div>
				{/if}
			</dl>

			{#if p.waterSchedule}
				<section class="mt-5">
					<h3 class="mb-3 text-base font-semibold text-slate-800">Monthly Water Requirements</h3>
					{#if p.waterSchedule.matchedBudget}
						{@const exportableNeeds = getExportableMonthNeeds(p.waterSchedule)}
						{@const exportableTotalPerAcre = exportableNeeds.reduce(
							(sum, item) => sum + item.waterM3PerAcre,
							0
						)}
						{@const exportableTotal = exportableNeeds.reduce((sum, item) => sum + item.waterM3, 0)}
						<p class="mb-3 text-sm text-slate-600">
							Season: <strong>{p.waterSchedule.season}</strong> · Area:
							<strong>{p.waterSchedule.acres.toFixed(2)} acres</strong>
						</p>
						<div class="overflow-hidden rounded-lg bg-white shadow-sm">
							<table class="w-full border-collapse text-sm">
								<thead>
									<tr>
										<th class="border-b border-slate-200 bg-blue-50 px-3 py-2 text-left font-semibold text-blue-800">Month</th>
										<th class="border-b border-slate-200 bg-blue-50 px-3 py-2 text-right font-semibold text-blue-800">Water per acre (m³)</th>
										<th class="border-b border-slate-200 bg-blue-50 px-3 py-2 text-right font-semibold text-blue-800">Total water (m³)</th>
									</tr>
								</thead>
								<tbody>
									{#each exportableNeeds as need}
										<tr>
											<td class="border-b border-slate-200 px-3 py-2 text-left text-slate-900">
												{formatCalendarMonth(need.calendarMonth, need.calendarYear)}
											</td>
											<td class="border-b border-slate-200 px-3 py-2 text-right text-slate-900">
												{roundWaterValue(need.waterM3PerAcre).toFixed(2)}
											</td>
											<td class="border-b border-slate-200 px-3 py-2 text-right text-slate-900">
												{roundWaterValue(need.waterM3).toFixed(2)}
											</td>
										</tr>
									{/each}
								</tbody>
								<tfoot>
									<tr>
										<th class="border-t-2 border-slate-300 bg-slate-50 px-3 py-2 text-left font-semibold text-slate-900">Total</th>
										<td class="border-t-2 border-slate-300 bg-slate-50 px-3 py-2 text-right font-semibold text-slate-900">
											{roundWaterValue(exportableTotalPerAcre).toFixed(2)}
										</td>
										<td class="border-t-2 border-slate-300 bg-slate-50 px-3 py-2 text-right font-semibold text-slate-900">
											{roundWaterValue(exportableTotal).toFixed(2)}
										</td>
									</tr>
								</tfoot>
							</table>
						</div>
					{:else}
						<p class="rounded-lg bg-amber-100 px-3 py-3 text-sm text-amber-800">
							{p.waterSchedule.note ?? 'Unable to calculate water budget.'}
						</p>
					{/if}
				</section>
			{/if}
		{:else}
			<div class="text-slate-500">
				<h2 class="mb-4 text-xl font-semibold text-slate-700">Select a plot</h2>
				<p>Click any polygon on the map to view farm details and monthly water requirements.</p>
				{#if groupByColumn}
					<p class="mt-2 text-sm">Plots are coloured by <strong>{groupByColumn}</strong>. Switch to Groups or Overall for aggregated water.</p>
				{/if}
			</div>
		{/if}
	</aside>
</div>
