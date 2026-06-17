<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { FarmFeatureProperties } from '$lib/gpkgParser';
	import { formatCalendarMonth } from '$lib/waterBudget';

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

<div class="layout">
	<div class="map-panel">
		<div bind:this={mapContainer} class="map"></div>
	</div>

	<aside class="details-panel">
		{#if selectedFeature}
			{@const p = featureProps(selectedFeature)}
			<h2>Farm Plot Details</h2>

			<dl class="details">
				{#if p.FarmerName}
					<div><dt>Farmer</dt><dd>{p.FarmerName}</dd></div>
				{/if}
				{#if p.Village}
					<div><dt>Village</dt><dd>{p.Village}</dd></div>
				{/if}
				{#if p.UniqueId}
					<div><dt>Plot ID</dt><dd>{p.UniqueId}</dd></div>
				{/if}
				{#if p.CROP_26_K}
					<div><dt>Crop (Kharif 2026)</dt><dd>{p.CROP_26_K}</dd></div>
				{/if}
				{#if p.Sowing_Date}
					<div><dt>Sowing Date</dt><dd>{p.Sowing_Date}</dd></div>
				{/if}
				{#if p.Acre}
					<div><dt>Area</dt><dd>{p.Acre.toFixed(2)} acres</dd></div>
				{/if}
				{#if p.IR_Status}
					<div><dt>IR Status</dt><dd>{p.IR_Status}</dd></div>
				{/if}
			</dl>

			{#if p.waterSchedule}
				<section class="water-section">
					<h3>Monthly Water Requirements</h3>
					{#if p.waterSchedule.matchedBudget}
						<p class="season-label">
							Season: <strong>{p.waterSchedule.season}</strong> · Area:
							<strong>{p.waterSchedule.acres.toFixed(2)} acres</strong>
						</p>
						<table>
							<thead>
								<tr>
									<th>Month</th>
									<th>Water per acre (mm)</th>
									<th>Total water (mm)</th>
								</tr>
							</thead>
							<tbody>
								{#each p.waterSchedule.monthlyNeeds as need}
									<tr>
										<td>{formatCalendarMonth(need.calendarMonth, need.calendarYear)}</td>
										<td>{need.waterMmPerAcre.toFixed(2)}</td>
										<td>{need.waterMm.toFixed(2)}</td>
									</tr>
								{/each}
							</tbody>
							<tfoot>
								<tr>
									<th>Total</th>
									<td>{p.waterSchedule.totalWaterMmPerAcre.toFixed(2)}</td>
									<td>{p.waterSchedule.totalWaterMm.toFixed(2)}</td>
								</tr>
							</tfoot>
						</table>
					{:else}
						<p class="warning">{p.waterSchedule.note ?? 'Unable to calculate water budget.'}</p>
					{/if}
				</section>
			{/if}
		{:else}
			<div class="empty-state">
				<h2>Select a plot</h2>
				<p>Click any polygon on the map to view farm details and monthly water requirements.</p>
			</div>
		{/if}
	</aside>
</div>

<style>
	.layout {
		display: grid;
		grid-template-columns: 1fr 360px;
		height: calc(100vh - 120px);
		gap: 0;
		border: 1px solid #e2e8f0;
		border-radius: 12px;
		overflow: hidden;
		background: #fff;
	}

	.map-panel {
		position: relative;
		min-height: 400px;
	}

	.map {
		width: 100%;
		height: 100%;
	}

	.details-panel {
		padding: 1.25rem;
		overflow-y: auto;
		border-left: 1px solid #e2e8f0;
		background: #f8fafc;
	}

	h2 {
		margin: 0 0 1rem;
		font-size: 1.25rem;
		color: #0f172a;
	}

	h3 {
		margin: 1.25rem 0 0.75rem;
		font-size: 1rem;
		color: #1e293b;
	}

	.details {
		display: grid;
		gap: 0.75rem;
		margin: 0;
	}

	.details div {
		display: grid;
		grid-template-columns: 110px 1fr;
		gap: 0.5rem;
	}

	dt {
		margin: 0;
		font-size: 0.8rem;
		font-weight: 600;
		color: #64748b;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	dd {
		margin: 0;
		color: #0f172a;
	}

	.season-label {
		margin: 0 0 0.75rem;
		font-size: 0.9rem;
		color: #475569;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
		background: #fff;
		border-radius: 8px;
		overflow: hidden;
		box-shadow: 0 1px 3px rgb(15 23 42 / 8%);
	}

	th,
	td {
		padding: 0.5rem 0.75rem;
		text-align: left;
		border-bottom: 1px solid #e2e8f0;
	}

	th:not(:first-child),
	td:not(:first-child) {
		text-align: right;
	}

	th {
		background: #eff6ff;
		color: #1e40af;
		font-weight: 600;
	}

	tr:last-child td {
		border-bottom: none;
	}

	tfoot th,
	tfoot td {
		background: #f8fafc;
		font-weight: 600;
		color: #0f172a;
		border-top: 2px solid #cbd5e1;
	}

	.warning {
		margin: 0;
		padding: 0.75rem;
		border-radius: 8px;
		background: #fef3c7;
		color: #92400e;
		font-size: 0.875rem;
	}

	.empty-state {
		color: #64748b;
	}

	.empty-state h2 {
		color: #334155;
	}

	@media (max-width: 900px) {
		.layout {
			grid-template-columns: 1fr;
			height: auto;
		}

		.map-panel {
			height: 50vh;
		}

		.details-panel {
			border-left: none;
			border-top: 1px solid #e2e8f0;
		}
	}
</style>
