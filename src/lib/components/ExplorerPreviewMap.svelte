<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type * as Leaflet from 'leaflet';

	interface Props {
		boundary: GeoJSON.FeatureCollection;
	}

	let { boundary }: Props = $props();

	let el: HTMLDivElement;
	let map: Leaflet.Map | null = null;
	let observer: ResizeObserver | null = null;

	onMount(async () => {
		const L = await import('leaflet');
		const m = L.map(el, { zoomControl: true, attributionControl: true });
		L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
			maxZoom: 19,
			attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
		}).addTo(m);
		const layer = L.geoJSON(boundary, {
			style: { color: '#fde047', weight: 2.5, opacity: 1, fillColor: '#fde047', fillOpacity: 0.12 }
		}).addTo(m);
		m.fitBounds(layer.getBounds(), { padding: [24, 24] });
		observer = new ResizeObserver(() => m.invalidateSize());
		observer.observe(el);
		map = m;
	});

	onDestroy(() => {
		observer?.disconnect();
		map?.remove();
		map = null;
	});
</script>

<div class="preview-map" bind:this={el}></div>

<style>
	.preview-map {
		width: 100%;
		height: 100%;
		min-height: 18rem;
	}
</style>
