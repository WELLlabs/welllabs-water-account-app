<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	interface Props {
		boundaries: GeoJSON.FeatureCollection;
	}

	let { boundaries }: Props = $props();

	let mapContainer: HTMLDivElement;
	let map = $state<import('leaflet').Map | null>(null);
	let boundaryLayer: import('leaflet').GeoJSON | null = null;

	const polygonStyle = {
		color: '#2563eb',
		weight: 2,
		fillColor: '#60a5fa',
		fillOpacity: 0.35
	};

	function renderBoundaries(L: typeof import('leaflet')) {
		if (!map) return;
		if (boundaryLayer) {
			boundaryLayer.remove();
			boundaryLayer = null;
		}
		if (boundaries.features.length === 0) return;

		boundaryLayer = L.geoJSON(boundaries, { style: polygonStyle }).addTo(map);
		const bounds = boundaryLayer.getBounds();
		if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24] });
	}

	onMount(async () => {
		const L = await import('leaflet');

		map = L.map(mapContainer, { zoomControl: true }).setView([16.3, 76.77], 14);
		L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
			maxZoom: 19,
			attribution: '© OpenStreetMap contributors'
		}).addTo(map);

		renderBoundaries(L);
	});

	onDestroy(() => map?.remove());
</script>

<div
	class="overflow-hidden rounded-xl border border-slate-200 bg-white"
	style="height: calc(100vh - 320px); min-height: 380px;"
>
	<div bind:this={mapContainer} class="h-full w-full"></div>
</div>
