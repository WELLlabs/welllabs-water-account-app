<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { FarmFeatureProperties } from '$lib/gpkgParser';
	import { formatCalendarMonth, getExportableMonthNeeds, roundWaterValue } from '$lib/waterBudget';

	interface Props {
		geojson: GeoJSON.FeatureCollection | null;
		selectedFeature: GeoJSON.Feature | null;
		onFeatureSelect: (feature: GeoJSON.Feature | null) => void;
	}

	let { geojson, selectedFeature, onFeatureSelect }: Props = $props();

	let mapContainer: HTMLDivElement;
	let map = $state<import('leaflet').Map | null>(null);
	let leafletModule = $state<typeof import('leaflet') | null>(null);
	let geoJsonLayer: import('leaflet').GeoJSON | null = null;

	const defaultStyle = {
		color: '#2563eb',
		weight: 2,
		fillColor: '#60a5fa',
		fillOpacity: 0.35
	};

	const selectedStyle = {
		color: '#1d4ed8',
		weight: 3,
		fillColor: '#3b82f6',
		fillOpacity: 0.55
	};

	onMount(async () => {
		leafletModule = await import('leaflet');
		map = leafletModule.map(mapContainer).setView([16.3, 76.77], 14);

		leafletModule
			.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
				maxZoom: 19,
				attribution: '&copy; OpenStreetMap contributors'
			})
			.addTo(map);
	});

	$effect(() => {
		if (!map || !leafletModule || !geojson) return;

		if (geoJsonLayer) {
			geoJsonLayer.remove();
			geoJsonLayer = null;
		}

		geoJsonLayer = leafletModule
			.geoJSON(geojson, {
				style: (feature) => {
					const isSelected =
						selectedFeature &&
						feature?.properties &&
						(selectedFeature.properties as FarmFeatureProperties)?.fid ===
							(feature.properties as FarmFeatureProperties)?.fid;
					return isSelected ? selectedStyle : defaultStyle;
				},
				onEachFeature: (feature, layer) => {
					layer.on('click', () => {
						onFeatureSelect(feature);
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
		geoJsonLayer.setStyle((feature) => {
			const isSelected =
				selectedFeature &&
				feature?.properties &&
				(selectedFeature.properties as FarmFeatureProperties)?.fid ===
					(feature.properties as FarmFeatureProperties)?.fid;
			return isSelected ? selectedStyle : defaultStyle;
		});
	});

	onDestroy(() => {
		map?.remove();
	});

	function featureProps(feature: GeoJSON.Feature): FarmFeatureProperties {
		return feature.properties as FarmFeatureProperties;
	}
</script>

<div
	class="grid h-[calc(100vh-120px)] grid-cols-1 overflow-hidden rounded-xl border border-slate-200 bg-white max-[900px]:h-auto max-[900px]:grid-cols-1 min-[901px]:grid-cols-[1fr_360px]"
>
	<div class="relative min-h-[400px] max-[900px]:h-[50vh]">
		<div bind:this={mapContainer} class="h-full w-full"></div>
	</div>

	<aside
		class="overflow-y-auto border-slate-200 bg-slate-50 p-5 min-[901px]:border-l max-[900px]:border-t"
	>
		{#if selectedFeature}
			{@const p = featureProps(selectedFeature)}
			<h2 class="mb-4 text-xl font-semibold text-slate-900">Farm Plot Details</h2>

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
							(sum, item) => sum + item.waterMmPerAcre,
							0
						)}
						{@const exportableTotal = exportableTotalPerAcre * p.waterSchedule.acres}
						<p class="mb-3 text-sm text-slate-600">
							Season: <strong>{p.waterSchedule.season}</strong> · Area:
							<strong>{p.waterSchedule.acres.toFixed(2)} acres</strong>
						</p>
						<div class="overflow-hidden rounded-lg bg-white shadow-sm">
							<table class="w-full border-collapse text-sm">
								<thead>
									<tr>
										<th
											class="border-b border-slate-200 bg-blue-50 px-3 py-2 text-left font-semibold text-blue-800"
											>Month</th
										>
										<th
											class="border-b border-slate-200 bg-blue-50 px-3 py-2 text-right font-semibold text-blue-800"
											>Water per acre (mm)</th
										>
										<th
											class="border-b border-slate-200 bg-blue-50 px-3 py-2 text-right font-semibold text-blue-800"
											>Total water (mm)</th
										>
									</tr>
								</thead>
								<tbody>
									{#each exportableNeeds as need}
										<tr>
											<td class="border-b border-slate-200 px-3 py-2 text-left text-slate-900">
												{formatCalendarMonth(need.calendarMonth, need.calendarYear)}
											</td>
											<td class="border-b border-slate-200 px-3 py-2 text-right text-slate-900">
												{roundWaterValue(need.waterMmPerAcre).toFixed(2)}
											</td>
											<td class="border-b border-slate-200 px-3 py-2 text-right text-slate-900">
												{roundWaterValue(need.waterMm).toFixed(2)}
											</td>
										</tr>
									{/each}
								</tbody>
								<tfoot>
									<tr>
										<th
											class="border-t-2 border-slate-300 bg-slate-50 px-3 py-2 text-left font-semibold text-slate-900"
											>Total</th
										>
										<td
											class="border-t-2 border-slate-300 bg-slate-50 px-3 py-2 text-right font-semibold text-slate-900"
										>
											{roundWaterValue(exportableTotalPerAcre).toFixed(2)}
										</td>
										<td
											class="border-t-2 border-slate-300 bg-slate-50 px-3 py-2 text-right font-semibold text-slate-900"
										>
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
			</div>
		{/if}
	</aside>
</div>
