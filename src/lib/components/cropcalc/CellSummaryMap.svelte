<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import type { CellTotals } from '$lib/regionBudget';
	import { fmt, fmtAcres } from './format';

	interface Props {
		cells: CellTotals[];
		boundary: GeoJSON.FeatureCollection | null;
		selectedId: string | null;
		onSelect: (id: string | null) => void;
	}

	let { cells, boundary, selectedId, onSelect }: Props = $props();

	const PALETTE = ['#e0f2fe', '#7dd3fc', '#38bdf8', '#0284c7', '#0c4a6e'];
	const EMPTY = '#94a3b8';

	let container: HTMLDivElement;
	let L = $state<typeof import('leaflet') | null>(null);
	let map = $state<import('leaflet').Map | null>(null);
	let cellLayer: import('leaflet').FeatureGroup | null = null;
	let boundaryLayer: import('leaflet').GeoJSON | null = null;
	let polygons = new Map<string, import('leaflet').Polygon>();
	let fitted = false;
	let resizeObserver: ResizeObserver | null = null;

	/** Quantile class breaks over cells with water need, so a few huge cells don't wash out the rest */
	const breaks = $derived.by(() => {
		const values = cells.map((c) => c.m3).filter((v) => v > 0).sort((a, b) => a - b);
		if (!values.length) return [] as number[];
		return [1, 2, 3, 4].map((q) => values[Math.min(values.length - 1, Math.floor((values.length * q) / 5))]);
	});

	function colorFor(m3: number): string {
		if (m3 <= 0) return EMPTY;
		let i = 0;
		while (i < breaks.length && m3 > breaks[i]) i++;
		return PALETTE[i];
	}

	function style(c: CellTotals, selected: boolean): import('leaflet').PathOptions {
		return {
			color: selected ? '#f59e0b' : 'rgba(15,23,42,0.35)',
			weight: selected ? 3 : 0.5,
			fillColor: colorFor(c.m3),
			fillOpacity: c.m3 > 0 ? 0.75 : 0.25
		};
	}

	onMount(async () => {
		L = await import('leaflet');
		map = L.map(container, { preferCanvas: true }).setView([16.2, 77.0], 9);
		L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
			maxZoom: 19,
			attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
		}).addTo(map);
		const created = map;
		resizeObserver = new ResizeObserver(() => created.invalidateSize());
		resizeObserver.observe(container);
	});

	$effect(() => {
		if (!map || !L) return;
		boundaryLayer?.remove();
		boundaryLayer = boundary
			? L.geoJSON(boundary, {
					interactive: false,
					style: { color: '#ffffff', weight: 2, dashArray: '6 4', fill: false, opacity: 0.9 }
				}).addTo(map)
			: null;
	});

	$effect(() => {
		if (!map || !L) return;
		void breaks;
		cellLayer?.remove();
		polygons = new Map();
		const selected = untrack(() => selectedId);
		const group = L.featureGroup();
		for (const c of cells) {
			const poly = L.polygon(
				c.ring.map(([lng, lat]) => [lat, lng] as [number, number]),
				style(c, c.id === selected)
			);
			poly.bindTooltip(
				`<strong>${fmt(c.m3)} m³</strong><br>${fmtAcres(c.acres)} ac of farm plots · ${fmt(c.plots)} plots<br><span style="color:#64748b">Click for plot-level detail</span>`,
				{ sticky: true }
			);
			poly.on('click', () => onSelect(c.id === untrack(() => selectedId) ? null : c.id));
			polygons.set(c.id, poly);
			group.addLayer(poly);
		}
		cellLayer = group.addTo(map);
		if (!fitted && cells.length) {
			const target = boundaryLayer?.getBounds() ?? group.getBounds();
			if (target.isValid()) map.fitBounds(target, { padding: [16, 16] });
			fitted = true;
		}
	});

	$effect(() => {
		const id = selectedId;
		for (const c of cells) {
			const poly = polygons.get(c.id);
			if (!poly) continue;
			poly.setStyle(style(c, c.id === id));
			if (c.id === id) poly.bringToFront();
		}
	});

	onDestroy(() => {
		resizeObserver?.disconnect();
		map?.remove();
	});
</script>

<div class="relative h-[60vh] min-h-[420px] overflow-hidden rounded-xl border border-slate-200">
	<div bind:this={container} class="h-full w-full"></div>
	{#if breaks.length}
		<div class="pointer-events-none absolute bottom-3 left-3 z-[500] rounded-lg border border-slate-200 bg-white/95 p-2.5 text-xs shadow">
			<p class="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Water need per cell (m³)</p>
			<ul class="space-y-1">
				{#each PALETTE as color, i}
					<li class="flex items-center gap-2">
						<span class="h-3 w-4 rounded-sm border border-black/10" style="background: {color}"></span>
						<span class="tabular-nums text-slate-600">
							{#if i === 0}
								≤ {fmt(breaks[0])}
							{:else if i === PALETTE.length - 1}
								> {fmt(breaks[breaks.length - 1])}
							{:else}
								{fmt(breaks[i - 1])} – {fmt(breaks[i])}
							{/if}
						</span>
					</li>
				{/each}
				<li class="flex items-center gap-2">
					<span class="h-3 w-4 rounded-sm border border-black/10" style="background: {EMPTY}; opacity: 0.5"></span>
					<span class="text-slate-600">No budgeted crops</span>
				</li>
			</ul>
		</div>
	{/if}
</div>
