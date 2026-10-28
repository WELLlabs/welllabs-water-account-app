<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import type * as Leaflet from 'leaflet';
	import {
		LAYERS,
		LAYER_BY_TYPE,
		colorizeGrey,
		cropColor,
		etImageUrl,
		waporMapUrl,
		isWaporKind,
		WAPOR_KIND_PRODUCT,
		WAPOR_ATTR,
		fieldSeasonCrop,
		formatCropLabel,
		loadGreyPixels,
		canalStyle,
		UNCERTAIN_COLOR,
		type GreyPixels,
		type AgriCellResponse,
		type AgriFeature,
		type AluType,
		type EtKind
	} from '$lib/tlab';
	import type { ProcessedGeoJson } from '$lib/gpkgParser';
	import { WATER_EMPTY } from '$lib/tlabWater.svelte';

	interface Props {
		grid: GeoJSON.FeatureCollection | null;
		boundary: GeoJSON.FeatureCollection | null;
		data: AgriCellResponse | null;
		selectedCellId: string | null;
		visible: Record<AluType, boolean>;
		showBoundary: boolean;
		showGrid: boolean;
		selectedFeatureId: string | null;
		/** 8-bit grey PNG (0 = no data) shown through rasterLut, e.g. a soil moisture frame */
		raster?: { url: string; bounds: [[number, number], [number, number]] } | null;
		rasterLut?: Uint8ClampedArray | null;
		/** Pointer readout for a raster byte; null hides it */
		rasterLabel?: (byte: number) => string | null;
		rasterOpacity?: number;
		wucs: GeoJSON.FeatureCollection | null;
		showWucs: boolean;
		canals: GeoJSON.FeatureCollection | null;
		showCanals: boolean;
		etMonth: string | null;
		etKind: EtKind | null;
		etOpacity: number;
		/** cellId → fill colour of the active cell choropleth (water budget, soil moisture); null hides it */
		cellFills: Map<string, string> | null;
		/** Optional per-cell fill opacity (crop survey coverage). Default 1 when omitted. */
		cellFillOpacity?: Map<string, number> | null;
		cellTooltip: (cellId: string) => string | null;
		waterPlots: ProcessedGeoJson | null;
		/** Zoomed in, cover every cell but the selected one with plain imagery */
		focusCover: boolean;
		waterPlotColors: Map<string, string>;
		waterSelectedPlot: string | null;
		waterSelectedCrop: string | null;
		onWaterPlotSelect: (plotId: string) => void;
		onCellSelect: (cellId: string) => void;
		onFeatureSelect: (feature: AgriFeature) => void;
		villages?: GeoJSON.FeatureCollection | null;
		showVillages?: boolean;
		/** Cadastral parcels (properties.pid), coloured by cropPlotFills */
		cropPlots?: GeoJSON.FeatureCollection | null;
		cropPlotFills?: Map<string, string>;
		cropPlotTooltip?: (pid: string) => string | null;
		selectedCropPlot?: string | null;
		onCropPlotSelect?: (pid: string) => void;
		/** Colour farm plots by the predicted crop for this season key ("Kharif 2025") */
		fieldCropSeason?: string | null;
		/** Map extent and zoom after every move */
		onView?: (bounds: [[number, number], [number, number]], zoom: number) => void;
	}

	let {
		grid,
		boundary,
		data,
		selectedCellId,
		visible,
		showBoundary,
		showGrid,
		selectedFeatureId,
		raster = null,
		rasterLut = null,
		rasterLabel = () => null,
		rasterOpacity = 0.85,
		wucs,
		showWucs,
		canals,
		showCanals,
		etMonth,
		etKind = null,
		etOpacity,
		cellFills,
		cellFillOpacity = null,
		cellTooltip,
		waterPlots,
		focusCover,
		waterPlotColors,
		waterSelectedPlot,
		waterSelectedCrop,
		onWaterPlotSelect,
		onCellSelect,
		onFeatureSelect,
		villages = null,
		showVillages = false,
		cropPlots = null,
		cropPlotFills = new Map(),
		cropPlotTooltip = () => null,
		selectedCropPlot = null,
		onCropPlotSelect = () => {},
		fieldCropSeason = null,
		onView = () => {}
	}: Props = $props();

	const RASTER_CACHE = 40;
	const rasterCache = new Map<string, { px: GreyPixels; url: string }>();
	let rasterCacheLut: Uint8ClampedArray | null = null;
	let rasterOverlay: Leaflet.ImageOverlay | null = null;
	let rasterPixels: GreyPixels | null = null;
	let rasterLoadToken = 0;
	let wucsLayer: Leaflet.GeoJSON | null = null;
	let canalLayer: Leaflet.GeoJSON | null = null;
	let etOverlay: Leaflet.SVGOverlay | null = null;
	let etImageOverlay: Leaflet.ImageOverlay | null = null;
	// Empty groups that only drive the layer-control checkboxes
	let pointer = $state<{ x: number; y: number; text: string | null } | null>(null);
	const readout = $derived(pointer?.text ? pointer : null);

	const featureLayerById = new Map<string, Leaflet.Path>();
	const featureBaseStyle = new Map<Leaflet.Path, Leaflet.PathOptions & { radius?: number }>();
	let highlighted: Leaflet.Path | null = null;

	// Leaflet forwards GeoJSON options to each vector layer, but its typings omit `renderer`
	type RenderedGeoJSONOptions = Leaflet.GeoJSONOptions & { renderer: Leaflet.Renderer };

	let mapContainer: HTMLDivElement;
	let L = $state<typeof Leaflet | null>(null);
	let map = $state<Leaflet.Map | null>(null);

	// Grid and features share one canvas: Leaflet canvases don't pass events to canvases below,
	// so a separate feature canvas would swallow every grid click once a cell has loaded.
	let vectorRenderer: Leaflet.Canvas | null = null;
	let boundaryRenderer: Leaflet.Canvas | null = null;

	let boundaryLayer = $state.raw<Leaflet.GeoJSON | null>(null);
	let gridLayer = $state.raw<Leaflet.GeoJSON | null>(null);
	const cellLayers = new Map<string, Leaflet.Polygon>();
	let featureLayers: Partial<Record<AluType, Leaflet.FeatureGroup>> = {};
	let selectionLayer: Leaflet.Polygon | null = null;
	let fittedBoundary = false;

	/** Bottom to top; wells last so they stay clickable above plots */
	const DRAW_ORDER: AluType[] = ['field', 'trees', 'other_water', 'farm_pond', 'dug_well'];

	function gridBaseStyle(): Leaflet.PathOptions {
		return {
			color: '#ffffff',
			weight: 0.6,
			opacity: 0.6,
			fillColor: '#1b75e0',
			fillOpacity: 0.02
		};
	}

	const gridHoverStyle: Leaflet.PathOptions = {
		color: '#ffffff',
		weight: 2,
		opacity: 1,
		fillColor: '#1b75e0',
		fillOpacity: 0.25
	};

	/** Grid style with the active choropleth fill; outlines vanish when only the choropleth is on */
	function cellStyle(id: string): Leaflet.PathOptions {
		const base = gridBaseStyle();
		if (!showGrid) {
			base.opacity = 0;
			base.fillOpacity = 0;
		}
		const fill = cellFills?.get(id);
		if (!fill) return base;
		// The selected cell's own plots carry the colour, so its fill would only hide them
		if ((waterPlots != null || cropPlotsVisible || fieldPlotsVisible) && id === selectedCellId) {
			return { ...base, fillColor: fill, fillOpacity: 0 };
		}
		return { ...base, fillColor: fill, fillOpacity: cellFillOpacity?.get(id) ?? 1 };
	}

	function cellHoverStyle(id: string): Leaflet.PathOptions {
		const fill = cellFills?.get(id);
		if (!fill) return gridHoverStyle;
		const o = cellFillOpacity?.get(id);
		return { ...gridHoverStyle, fillColor: fill, fillOpacity: o != null ? Math.min(1, o + 0.12) : 1 };
	}

	let restyleRaf = 0;
	function restyleCells() {
		if (restyleRaf) return;
		restyleRaf = requestAnimationFrame(() => {
			restyleRaf = 0;
			try {
				for (const [id, cell] of cellLayers) cell.setStyle(cellStyle(id));
			} catch {
				/* Leaflet canvas can drop _ctx while a previous redraw is still in flight */
			}
		});
	}

	const selectionStyle: Leaflet.PathOptions = {
		color: '#f472b6',
		weight: 3,
		opacity: 1,
		fill: false,
		interactive: false
	};

	/** Keep features above the grid and the selection outline on top of everything */
	function restack() {
		if (!map) return;
		cropPlotLayer?.bringToFront();
		if (selectedCropPlot) cropPlotById.get(selectedCropPlot)?.bringToFront();
		for (const type of DRAW_ORDER) {
			const layer = featureLayers[type];
			if (layer && map.hasLayer(layer)) layer.bringToFront();
			if (type === 'field') waterPlotLayer?.bringToFront();
		}
		if (waterSelectedPlot) waterPlotById.get(waterSelectedPlot)?.bringToFront();
		selectionLayer?.bringToFront();
	}

	let waterPlotLayer: Leaflet.GeoJSON | null = null;
	const waterPlotById = new Map<string, Leaflet.Path>();
	const waterPlotCrop = new Map<string, string>();

	function waterPlotStyle(id: string): Leaflet.PathOptions {
		const fill = waterPlotColors.get(id) ?? WATER_EMPTY;
		if (id === waterSelectedPlot) return { color: '#f472b6', weight: 3.5, opacity: 1, fillColor: fill, fillOpacity: 1 };
		const dimmed = waterSelectedCrop != null && waterPlotCrop.get(id) !== waterSelectedCrop;
		return {
			color: '#ffffff',
			weight: 1,
			opacity: dimmed ? 0.3 : 0.9,
			fillColor: fill,
			fillOpacity: dimmed ? 0.15 : 1
		};
	}

	$effect(() => {
		const fc = waterPlots;
		if (!L || !map) return;
		waterPlotLayer?.remove();
		waterPlotLayer = null;
		waterPlotById.clear();
		waterPlotCrop.clear();
		if (!fc) return;
		const leaflet = L;
		const m = map;
		untrack(() => {
			waterPlotLayer = leaflet.geoJSON(fc as GeoJSON.FeatureCollection, <RenderedGeoJSONOptions>{
				renderer: vectorRenderer!,
				style: (f) => waterPlotStyle(String(f?.properties?.plot_id)),
				onEachFeature: (f, layer) => {
					const id = String(f.properties?.plot_id);
					waterPlotById.set(id, layer as Leaflet.Path);
					waterPlotCrop.set(id, String(f.properties?.crop));
					layer.on('click', () => onWaterPlotSelect(id));
				}
			});
			waterPlotLayer.addTo(m);
			restack();
		});
	});

	$effect(() => {
		void waterPlotColors;
		void waterSelectedPlot;
		void waterSelectedCrop;
		untrack(() => {
			for (const [id, layer] of waterPlotById) layer.setStyle(waterPlotStyle(id));
			restack();
		});
	});

	let cropPlotLayer: Leaflet.GeoJSON | null = null;
	const cropPlotById = new Map<string, Leaflet.Path>();

	function cropPlotStyle(pid: string): Leaflet.PathOptions {
		const fill = cropPlotFills.get(pid);
		if (pid === selectedCropPlot) return { color: '#f472b6', weight: 3, opacity: 1, fillColor: fill ?? '#ffffff', fillOpacity: fill ? 0.95 : 0.1 };
		return {
			color: '#ffffff',
			weight: 0.8,
			opacity: 0.75,
			fillColor: fill ?? '#ffffff',
			fillOpacity: fill ? 0.85 : 0.04
		};
	}

	$effect(() => {
		const fc = cropPlotsVisible ? cropPlots : null;
		if (!L || !map) return;
		const leaflet = L;
		const m = map;
		untrack(() => {
			cropPlotLayer?.remove();
			cropPlotLayer = null;
			cropPlotById.clear();
			if (!fc) return;
			cropPlotLayer = leaflet.geoJSON(fc, <RenderedGeoJSONOptions>{
				renderer: vectorRenderer!,
				style: (f) => cropPlotStyle(String(f?.properties?.pid)),
				onEachFeature: (f, layer) => {
					const pid = String(f.properties?.pid);
					const path = layer as Leaflet.Path;
					cropPlotById.set(pid, path);
					path.on('mouseover', (e: Leaflet.LeafletMouseEvent) => {
						path.setStyle({ weight: 2.5, opacity: 1 });
						const tip = cropPlotTooltip(pid);
						if (tip) path.bindTooltip(tip, { sticky: true, className: 'tlab-canal-tip' }).openTooltip(e.latlng);
					});
					path.on('mouseout', () => {
						path.setStyle(cropPlotStyle(pid));
						path.unbindTooltip();
					});
					path.on('click', (e: Leaflet.LeafletMouseEvent) => {
						leaflet.DomEvent.stop(e);
						onCropPlotSelect(pid);
					});
				}
			});
			cropPlotLayer.addTo(m);
			restack();
		});
	});

	$effect(() => {
		void cropPlotFills;
		void selectedCropPlot;
		untrack(() => {
			for (const [pid, layer] of cropPlotById) layer.setStyle(cropPlotStyle(pid));
			restack();
		});
	});

	let villageLayer: Leaflet.GeoJSON | null = null;

	function villageStyle(): Leaflet.PathOptions {
		const near = (map?.getZoom() ?? zoom) >= 12;
		return { color: '#e2e8f0', weight: near ? 1.2 : 0.5, opacity: near ? 0.85 : 0.4, fill: false };
	}

	function clearVillageLabels() {
		villageLayer?.eachLayer((layer) => {
			const path = layer as Leaflet.Layer;
			if (path.getTooltip?.()) path.unbindTooltip();
		});
	}

	function syncVillageLabels() {
		if (!villageLayer || !map || !showVillages || map.getZoom() < 12) {
			clearVillageLabels();
			return;
		}
		const bounds = map.getBounds();
		villageLayer.eachLayer((layer) => {
			const path = layer as Leaflet.Polyline & { _villageName?: string };
			const inView = typeof path.getBounds === 'function' && bounds.intersects(path.getBounds());
			const has = path.getTooltip();
			if (inView && !has) {
				path
					.bindTooltip(path._villageName ?? '', {
						permanent: true,
						direction: 'center',
						className: 'tlab-village-label'
					})
					.openTooltip();
			} else if (!inView && has) {
				path.unbindTooltip();
			}
		});
	}

	$effect(() => {
		const fc = villages;
		if (!L || !map) return;
		if (fc && !villageLayer) {
			villageLayer = L.geoJSON(fc, <RenderedGeoJSONOptions>{
				pane: 'tlabBoundary',
				renderer: boundaryRenderer!,
				interactive: false,
				style: villageStyle,
				onEachFeature: (feature, layer) => {
					(layer as Leaflet.Layer & { _villageName?: string })._villageName = String(
						feature.properties?.name ?? ''
					);
				}
			});
		}
		if (!villageLayer) return;
		if (showVillages) {
			villageLayer.addTo(map);
			untrack(syncVillageLabels);
		} else {
			clearVillageLabels();
			villageLayer.remove();
		}
	});

	export function zoomToWaterPlot(id: string) {
		const layer = waterPlotById.get(id) as Leaflet.Polygon | undefined;
		if (map && layer) map.fitBounds(layer.getBounds(), { padding: [80, 80], maxZoom: 18 });
	}

	export function zoomToWaterCrop(crop: string) {
		if (!map || !L) return;
		const bounds = L.latLngBounds([]);
		for (const [id, layer] of waterPlotById) {
			if (waterPlotCrop.get(id) === crop) bounds.extend((layer as Leaflet.Polygon).getBounds());
		}
		if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
	}

	onMount(async () => {
		const leaflet = await import('leaflet');
		const m = leaflet.map(mapContainer, { preferCanvas: true }).setView([16.2, 76.9], 9);

		m.createPane('tlabVectors').style.zIndex = '410';
		m.createPane('tlabBoundary').style.zIndex = '415';
		m.getPane('tlabBoundary')!.style.pointerEvents = 'none';
		m.createPane('tlabRaster').style.zIndex = '380';
		m.getPane('tlabRaster')!.style.pointerEvents = 'none';
		// SVG above the feature canvas: only the canal strokes take pointer events
		m.createPane('tlabCanals').style.zIndex = '412';
		m.createPane('tlabHydro').style.zIndex = '370';
		m.getPane('tlabHydro')!.style.pointerEvents = 'none';
		// Plain imagery over every overlay when zoomed in, with a hole over the selected cell
		m.createPane('tlabFocus').style.zIndex = '414';
		m.getPane('tlabFocus')!.style.pointerEvents = 'none';

		m.on('mousemove', (e: Leaflet.LeafletMouseEvent) => {
			const byte = sampleRaster(e.latlng);
			pointer = { x: e.containerPoint.x, y: e.containerPoint.y, text: byte ? rasterLabel(byte) : null };
		});
		const clearPointer = () => (pointer = null);
		m.on('mouseout', clearPointer);
		mapContainer.addEventListener('mouseleave', clearPointer);

		vectorRenderer = leaflet.canvas({ pane: 'tlabVectors', padding: 0.2, updateWhenZooming: false });
		boundaryRenderer = leaflet.canvas({ pane: 'tlabBoundary', padding: 0.2, updateWhenZooming: false });

		const imagery = leaflet.tileLayer(
			'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
			{
				maxZoom: 19,
				attribution:
					'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
			}
		);
		const osm = leaflet.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
			maxZoom: 19,
			attribution: '© OpenStreetMap contributors'
		});
		imagery.addTo(m);
		focusImagery = leaflet.tileLayer(
			'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
			{ pane: 'tlabFocus', maxZoom: 19 }
		);
		leaflet.control.layers({ Satellite: imagery, Streets: osm }, undefined, { position: 'topright' }).addTo(m);
		leaflet.control.scale({ imperial: false }).addTo(m);

		const syncZoomClasses = () => {
			mapContainer.classList.toggle('tlab-zoomed-out', m.getZoom() < 12);
		};
		m.on('zoomstart', () => {
			mapContainer.classList.add('tlab-zooming');
			untrack(clearVillageLabels);
		});
		m.on('zoomend', () => {
			mapContainer.classList.remove('tlab-zooming');
			syncZoomClasses();
			zoom = m.getZoom();
			untrack(updateFocusClip);
			untrack(updateHydroClip);
		});
		m.on('viewreset', () => {
			untrack(updateFocusClip);
			untrack(updateHydroClip);
		});
		m.on('moveend', () => {
			untrack(syncVillageLabels);
			const b = m.getBounds();
			onView(
				[
					[b.getSouth(), b.getWest()],
					[b.getNorth(), b.getEast()]
				],
				m.getZoom()
			);
		});
		syncZoomClasses();

		resizeObserver = new ResizeObserver(() => m.invalidateSize());
		resizeObserver.observe(mapContainer);

		L = leaflet;
		map = m;
	});

	let resizeObserver: ResizeObserver | null = null;

	onDestroy(() => {
		resizeObserver?.disconnect();
		map?.remove();
		map = null;
	});

	$effect(() => {
		if (!L || !map || !boundary || boundaryLayer) return;
		boundaryLayer = L.geoJSON(boundary, <RenderedGeoJSONOptions>{
			pane: 'tlabBoundary',
			renderer: boundaryRenderer!,
			interactive: false,
			style: { color: '#fde047', weight: 2.5, opacity: 1, fill: false }
		});
		if (!fittedBoundary) {
			map.fitBounds(boundaryLayer.getBounds(), { padding: [20, 20] });
			fittedBoundary = true;
		}
	});

	$effect(() => {
		if (!map || !boundaryLayer) return;
		if (showBoundary) boundaryLayer.addTo(map);
		else boundaryLayer.remove();
	});

	$effect(() => {
		if (!L || !map || !grid || gridLayer) return;
		const leaflet = L;
		gridLayer = untrack(() =>
			leaflet.geoJSON(grid, <RenderedGeoJSONOptions>{
				renderer: vectorRenderer!,
				style: (feature) => cellStyle(String(feature?.properties?.cellId ?? '')),
				onEachFeature: (feature, layer) => {
					const id = String(feature.properties?.cellId ?? '');
					const cell = layer as Leaflet.Polygon;
					cellLayers.set(id, cell);
					// The selected cell is already open: the gaps between its features stay inert
					cell.on('mouseover', (e: Leaflet.LeafletMouseEvent) => {
						if (id === selectedCellId) return;
						cell.setStyle(cellHoverStyle(id));
						focusOutlines.get(id)?.setStyle(focusOutlineHover);
						const tip = cellFills && !outsideFocus(e.latlng) ? cellTooltip(id) : null;
						if (tip) cell.bindTooltip(tip, { sticky: true, className: 'tlab-canal-tip' }).openTooltip(e.latlng);
					});
					cell.on('mouseout', () => {
						cell.setStyle(cellStyle(id));
						focusOutlines.get(id)?.setStyle(focusOutlineStyle);
						cell.unbindTooltip();
					});
					cell.on('click', () => {
						if (id === selectedCellId) return;
						cell.unbindTooltip();
						cell.setStyle(cellStyle(id));
						onCellSelect(id);
					});
				}
			})
		);
	});

	$effect(() => {
		void cellFills;
		void cellFillOpacity;
		void showGrid;
		void waterPlots;
		void cropPlots;
		void cropPlotsVisible;
		void fieldPlotsVisible;
		void selectedCellId;
		if (!gridLayer) return;
		untrack(restyleCells);
	});

	$effect(() => {
		// Always on the map (transparent when hidden) so cells stay selectable
		if (!map || !gridLayer) return;
		gridLayer.addTo(map);
		restack();
	});

	$effect(() => {
		const id = selectedCellId;
		if (!L || !map || !gridLayer) return;
		selectionLayer?.remove();
		selectionLayer = null;
		if (!id) return;
		const cell = cellLayers.get(id);
		if (!cell) return;
		selectionLayer = L.polygon(cell.getLatLngs() as Leaflet.LatLngExpression[][], {
			...selectionStyle,
			pane: 'tlabBoundary'
		}).addTo(map);
		map.fitBounds(cell.getBounds(), { padding: [40, 40], maxZoom: 16 });
	});

	/** Zoom from which only the selected cell shows overlays; everything else is plain imagery */
	const FOCUS_ZOOM = 13;
	let zoom = $state(9);
	let focusImagery: Leaflet.TileLayer | null = null;
	const focused = $derived(focusCover && zoom >= FOCUS_ZOOM);
	/** Cadastral parcels only when they can be seen; otherwise the cell choropleth stays on. */
	const cropPlotsVisible = $derived(cropPlots != null && zoom >= FOCUS_ZOOM);
	/** Google ALU farm plots in the selected cell, same zoom rule as crop-survey parcels. */
	const fieldPlotsVisible = $derived(Boolean(data?.features.length) && Boolean(visible.field) && zoom >= FOCUS_ZOOM);

	function updateFocusClip() {
		const pane = map?.getPane('tlabFocus');
		if (!map || !pane) return;
		const ring = selectedCellId ? (cellLayers.get(selectedCellId)?.getLatLngs()[0] as Leaflet.LatLng[] | undefined) : undefined;
		if (!ring?.length) {
			pane.style.clipPath = 'none';
			return;
		}
		const m = map;
		const hole = ring.map((ll, i) => {
			const p = m.latLngToLayerPoint(ll);
			return `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
		});
		const far = 10_000_000;
		pane.style.clipPath = `path(evenodd, "M${-far} ${-far}H${far}V${far}H${-far}Z ${hole.join(' ')}Z")`;
	}

	/** Clip the WaPOR image overlay to the district; SVG (NRSC) already clips internally. */
	function updateHydroClip() {
		const pane = map?.getPane('tlabHydro');
		if (!map || !pane || !L) return;
		if (!isWaporKind(etKind) || !boundary) {
			pane.style.clipPath = 'none';
			return;
		}
		const m = map;
		const leaflet = L;
		const parts: string[] = [];
		for (const f of boundary.features) {
			const g = f.geometry;
			const polys: number[][][][] =
				g.type === 'Polygon' ? [g.coordinates as number[][][]] : g.type === 'MultiPolygon' ? (g.coordinates as number[][][][]) : [];
			for (const poly of polys) {
				for (const ring of poly) {
					const d = ring.map((c, i) => {
						const p = m.latLngToLayerPoint(leaflet.latLng(c[1], c[0]));
						return `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
					});
					parts.push(`${d.join(' ')}Z`);
				}
			}
		}
		pane.style.clipPath = parts.length ? `path(evenodd, "${parts.join(' ')}")` : 'none';
	}

	// Cell outlines drawn above the imagery cover so other cells stay visible to click;
	// clicks still reach the interactive grid underneath
	let focusGrid: Leaflet.GeoJSON | null = null;
	const focusOutlines = new Map<string, Leaflet.Path>();
	const focusOutlineStyle: Leaflet.PathOptions = { color: '#ffffff', weight: 1, opacity: 0.55, fill: false };
	const focusOutlineHover: Leaflet.PathOptions = { color: '#ffffff', weight: 2.5, opacity: 1, fill: false };

	$effect(() => {
		const on = focused;
		const outlines = showGrid;
		void selectedCellId;
		if (!L || !map || !focusImagery || !grid) return;
		const leaflet = L;
		const m = map;
		untrack(() => {
			if (!focusGrid) {
				focusGrid = leaflet.geoJSON(grid!, <RenderedGeoJSONOptions>{
					pane: 'tlabBoundary',
					renderer: boundaryRenderer!,
					interactive: false,
					style: () => focusOutlineStyle,
					onEachFeature: (f, layer) => focusOutlines.set(String(f.properties?.cellId ?? ''), layer as Leaflet.Path)
				});
			}
			if (on) {
				updateFocusClip();
				focusImagery!.addTo(m);
				if (outlines) focusGrid.addTo(m);
				else focusGrid.remove();
				selectionLayer?.bringToFront();
			} else {
				focusImagery!.remove();
				focusGrid.remove();
			}
		});
	});

	$effect(() => {
		mapContainer?.classList.toggle('tlab-plots-focus', focused && (waterPlots != null || cropPlots != null));
	});

	function outsideFocus(latlng: Leaflet.LatLng): boolean {
		if (!focused) return false;
		const cell = selectedCellId ? cellLayers.get(selectedCellId) : undefined;
		return !cell || !cell.getBounds().contains(latlng);
	}

	/** Raw raster byte under the pointer; 0 where there is none */
	function sampleRaster(latlng: Leaflet.LatLng): number {
		if (!raster || !rasterPixels || !rasterOverlay || !map?.hasLayer(rasterOverlay) || outsideFocus(latlng)) return 0;
		const [[s, w], [n, e]] = raster.bounds;
		if (latlng.lat < s || latlng.lat > n || latlng.lng < w || latlng.lng > e) return 0;
		const col = Math.min(rasterPixels.width - 1, Math.floor(((latlng.lng - w) / (e - w)) * rasterPixels.width));
		const row = Math.min(rasterPixels.height - 1, Math.floor(((n - latlng.lat) / (n - s)) * rasterPixels.height));
		return rasterPixels.data[row * rasterPixels.width + col];
	}

	const BOX_SNAP = 0.15;
	const SVG_NS = 'http://www.w3.org/2000/svg';

	/** District extent, padded out to a round grid for the ET overlay */
	const districtBox = $derived.by((): [[number, number], [number, number]] | null => {
		if (!boundaryLayer) return null;
		const b = boundaryLayer.getBounds();
		return [
			[Math.floor(b.getSouth() / BOX_SNAP) * BOX_SNAP, Math.floor(b.getWest() / BOX_SNAP) * BOX_SNAP],
			[Math.ceil(b.getNorth() / BOX_SNAP) * BOX_SNAP, Math.ceil(b.getEast() / BOX_SNAP) * BOX_SNAP]
		];
	});

	/**
	 * Bhuvan sends no CORS headers, so pixels can't be masked on a canvas; an SVG <image>
	 * clipped to the district outline displays the cross-origin map without reading it.
	 */
	function districtSvg(box: [[number, number], [number, number]], cls: string) {
		const [[s, w], [n, e]] = box;
		const W = 1000;
		const H = Math.round((W * (n - s)) / (e - w));
		const svg = document.createElementNS(SVG_NS, 'svg');
		svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
		svg.setAttribute('preserveAspectRatio', 'none');
		const clipId = `tlab-clip-${cls}`;
		const defs = document.createElementNS(SVG_NS, 'defs');
		const clip = document.createElementNS(SVG_NS, 'clipPath');
		clip.setAttribute('id', clipId);
		const path = document.createElementNS(SVG_NS, 'path');
		const rings: number[][][] = [];
		for (const f of boundary?.features ?? []) {
			const g = f.geometry;
			if (g.type === 'Polygon') rings.push(...(g.coordinates as number[][][]));
			else if (g.type === 'MultiPolygon') for (const poly of g.coordinates as number[][][][]) rings.push(...poly);
		}
		const d = rings
			.map(
				(ring) =>
					'M' +
					ring
						.map(([x, y]) => `${(((x - w) / (e - w)) * W).toFixed(1)},${(((n - y) / (n - s)) * H).toFixed(1)}`)
						.join('L') +
					'Z'
			)
			.join('');
		path.setAttribute('d', d);
		path.setAttribute('clip-rule', 'evenodd');
		clip.appendChild(path);
		defs.appendChild(clip);
		svg.appendChild(defs);
		const image = document.createElementNS(SVG_NS, 'image');
		image.setAttribute('x', '0');
		image.setAttribute('y', '0');
		image.setAttribute('width', String(W));
		image.setAttribute('height', String(H));
		image.setAttribute('preserveAspectRatio', 'none');
		image.setAttribute('clip-path', `url(#${clipId})`);
		image.setAttribute('class', 'tlab-hydro-img');
		svg.appendChild(image);
		return { svg, image };
	}

	let etImage: SVGImageElement | null = null;
	let etOverlayKind: EtKind | null = null;

	$effect(() => {
		const month = etMonth;
		const kind = etKind;
		const box = districtBox;
		if (!L || !map) return;
		if (!month || !kind || !box) {
			etOverlay?.remove();
			etImageOverlay?.remove();
			etOverlayKind = null;
			untrack(updateHydroClip);
			return;
		}
		if (isWaporKind(kind)) {
			etOverlay?.remove();
			etOverlay = null;
			etImage = null;
			const url = waporMapUrl(WAPOR_KIND_PRODUCT[kind], month, box, 900);
			if (!etImageOverlay || etOverlayKind !== kind) {
				etImageOverlay?.remove();
				etImageOverlay = L.imageOverlay(url, box, {
					pane: 'tlabHydro',
					interactive: false,
					className: 'tlab-hydro-img',
					opacity: untrack(() => etOpacity),
					attribution: WAPOR_ATTR[kind]
				});
				etOverlayKind = kind;
			} else {
				etImageOverlay.setUrl(url);
				etImageOverlay.setBounds(L.latLngBounds(box));
			}
			if (!map.hasLayer(etImageOverlay)) etImageOverlay.addTo(map);
			untrack(updateHydroClip);
			return;
		}
		etImageOverlay?.remove();
		etImageOverlay = null;
		if (!etOverlay || etOverlayKind !== kind) {
			etOverlay?.remove();
			const { svg, image } = districtSvg(box, 'et');
			etImage = image;
			etOverlayKind = kind;
			etOverlay = L.svgOverlay(svg, box, {
				pane: 'tlabHydro',
				interactive: false,
				opacity: untrack(() => etOpacity),
				attribution: 'ET © NRSC/ISRO Bhuvan (NHP)'
			});
		}
		etImage?.setAttribute('href', etImageUrl(month, box, 900));
		if (!map.hasLayer(etOverlay)) etOverlay.addTo(map);
		untrack(updateHydroClip);
	});

	$effect(() => {
		etOverlay?.setOpacity(etOpacity);
		etImageOverlay?.setOpacity(etOpacity);
	});

	async function rasterFrame(url: string, lut: Uint8ClampedArray) {
		if (lut !== rasterCacheLut) {
			rasterCache.clear();
			rasterCacheLut = lut;
		}
		const cached = rasterCache.get(url);
		if (cached) return cached;
		const px = await loadGreyPixels(url);
		const frame = { px, url: colorizeGrey(px, lut).toDataURL() };
		rasterCache.set(url, frame);
		while (rasterCache.size > RASTER_CACHE) rasterCache.delete(rasterCache.keys().next().value!);
		return frame;
	}

	let rasterError = $state<string | null>(null);

	$effect(() => {
		const r = raster;
		const lut = rasterLut;
		if (!L || !map) return;
		const token = ++rasterLoadToken;
		rasterError = null;
		if (!r || !lut) {
			rasterOverlay?.remove();
			rasterPixels = null;
			untrack(() => {
				if (pointer?.text) pointer = { ...pointer, text: null };
			});
			return;
		}
		rasterFrame(r.url, lut).then(
			(frame) => {
				if (token !== rasterLoadToken || !L || !map) return;
				rasterPixels = frame.px;
				if (!rasterOverlay) {
					rasterOverlay = L.imageOverlay(frame.url, r.bounds, {
						pane: 'tlabRaster',
						interactive: false,
						className: 'tlab-raster-img',
						opacity: untrack(() => rasterOpacity)
					});
				} else {
					rasterOverlay.setUrl(frame.url);
					rasterOverlay.setBounds(L.latLngBounds(r.bounds));
				}
				if (!map.hasLayer(rasterOverlay)) rasterOverlay.addTo(map);
			},
			() => {
				if (token === rasterLoadToken) rasterError = 'Could not load this map frame.';
			}
		);
	});

	$effect(() => {
		rasterOverlay?.setOpacity(rasterOpacity);
	});

	$effect(() => {
		const fc = wucs;
		if (!L || !map) return;
		if (fc && !wucsLayer) {
			wucsLayer = L.geoJSON(fc, <RenderedGeoJSONOptions>{
				pane: 'tlabBoundary',
				renderer: boundaryRenderer!,
				interactive: false,
				style: { color: '#fb923c', weight: 2, opacity: 0.95, dashArray: '6 4', fill: false },
				onEachFeature: (feature, layer) => {
					const p = feature.properties ?? {};
					layer.bindTooltip(`WUCS ${p.WUCS ?? ''}`, {
						permanent: true,
						direction: 'center',
						className: 'tlab-wucs-label'
					});
				}
			});
		}
		if (!wucsLayer) return;
		if (showWucs) wucsLayer.addTo(map);
		else wucsLayer.remove();
	});

	function canalTooltip(p: Record<string, unknown>): string {
		const esc = (v: unknown) =>
			String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
		const name = p.canname || p.Label || 'Unnamed canal';
		const project = p.prjname && p.prjname !== 'No name' ? p.prjname : null;
		const len = typeof p.length_m === 'number' ? `${(p.length_m / 1000).toFixed(p.length_m < 10_000 ? 2 : 1)} km` : '';
		return [
			`<strong>${esc(name)}</strong>`,
			`${esc(canalStyle(Number(p.can_type)).label)}${len ? ` · ${len}` : ''}`,
			project ? esc(project) : ''
		]
			.filter(Boolean)
			.join('<br>');
	}

	$effect(() => {
		const fc = canals;
		if (!L || !map) return;
		if (fc && !canalLayer) {
			const renderer = L.svg({ pane: 'tlabCanals', padding: 0.2, updateWhenZooming: false });
			canalLayer = L.geoJSON(fc, {
				pane: 'tlabCanals',
				style: (f) => {
					const s = canalStyle(Number(f?.properties?.can_type));
					return { color: s.color, weight: s.weight, opacity: 0.95, lineCap: 'round', renderer } as Leaflet.PathOptions;
				},
				onEachFeature: (feature, layer) => {
					const path = layer as Leaflet.Path;
					const base = canalStyle(Number(feature.properties?.can_type));
					path.bindTooltip(canalTooltip(feature.properties ?? {}), {
						sticky: true,
						className: 'tlab-canal-tip'
					});
					path.on('mouseover', () => path.setStyle({ weight: base.weight + 2.5, color: '#f59e0b' }));
					path.on('mouseout', () => path.setStyle({ weight: base.weight, color: base.color }));
				}
			});
		}
		if (!canalLayer) return;
		if (showCanals) canalLayer.addTo(map);
		else canalLayer.remove();
	});

	function centerOf(feature: AgriFeature): Leaflet.LatLng {
		return L!.geoJSON(feature).getBounds().getCenter();
	}

	const highlightStyle: Leaflet.PathOptions = {
		color: '#22d3ee',
		weight: 3.5,
		opacity: 1,
		fillColor: '#22d3ee',
		fillOpacity: 0.4
	};

	function registerFeature(feature: AgriFeature, layer: Leaflet.Path, base: Leaflet.PathOptions) {
		const id = String(feature.id ?? '');
		if (id) featureLayerById.set(id, layer);
		featureBaseStyle.set(layer, base);
		layer.on('click', () => onFeatureSelect(feature));
	}

	function fieldCropTip(crop: string | null): string {
		if (!crop) return '<span style="color:#64748b">No crop prediction this season</span>';
		const name = formatCropLabel(crop);
		if (crop === 'UNKNOWN_CROP' || name === 'Unknown') {
			return `<strong>${name}</strong><br><span style="color:#64748b">ALU ran a crop call but could not name the crop</span>`;
		}
		if (crop === 'NO_PREDICTION' || name === 'No prediction') {
			return `<strong>${name}</strong><br><span style="color:#64748b">No crop call this season. This is not fallow.</span>`;
		}
		return `<strong>${name}</strong>`;
	}

	function fieldStyle(feature: AgriFeature): Leaflet.PathOptions {
		const crop = fieldSeasonCrop(feature.properties?.monitoring_prediction, fieldCropSeason);
		const fill = crop ? cropColor(crop) : UNCERTAIN_COLOR;
		return {
			color: '#ffffff',
			weight: 1.1,
			opacity: 0.9,
			fillColor: fill,
			fillOpacity: crop ? 0.72 : 0.28
		};
	}

	function buildTypeLayer(type: AluType, features: AgriFeature[]): Leaflet.FeatureGroup {
		const leaflet = L!;
		const color = LAYER_BY_TYPE[type]?.color ?? '#94a3b8';

		if (type === 'dug_well') {
			const group = leaflet.featureGroup();
			const base = { radius: 6, color: '#ffffff', weight: 1.5, fillColor: color, fillOpacity: 0.95 };
			for (const f of features) {
				const marker = leaflet
					.circleMarker(centerOf(f), { ...base, renderer: vectorRenderer! })
					.addTo(group);
				registerFeature(f, marker, base);
			}
			return group;
		}

		if (type === 'field') {
			return leaflet.geoJSON(features as GeoJSON.Feature[], <RenderedGeoJSONOptions>{
				renderer: vectorRenderer!,
				style: (f) => fieldStyle(f as AgriFeature),
				onEachFeature: (feature, layer) => {
					const f = feature as AgriFeature;
					const path = layer as Leaflet.Path;
					const base = fieldStyle(f);
					const crop = fieldSeasonCrop(f.properties?.monitoring_prediction, fieldCropSeason);
					path.bindTooltip(fieldCropTip(crop), { sticky: true, className: 'tlab-canal-tip' });
					registerFeature(f, path, base);
				}
			});
		}

		const base: Leaflet.PathOptions = {
			color,
			weight: type === 'trees' ? 1 : 1.6,
			opacity: 1,
			fillColor: color,
			fillOpacity: 0.35
		};
		return leaflet.geoJSON(features as GeoJSON.Feature[], <RenderedGeoJSONOptions>{
			renderer: vectorRenderer!,
			style: base,
			onEachFeature: (feature, layer) => registerFeature(feature as AgriFeature, layer as Leaflet.Path, base)
		});
	}

	function setHighlight(layer: Leaflet.Path | null) {
		if (highlighted && highlighted !== layer) {
			const base = featureBaseStyle.get(highlighted);
			if (base) {
				highlighted.setStyle(base);
				if (base.radius != null) (highlighted as Leaflet.CircleMarker).setRadius(base.radius);
			}
		}
		highlighted = layer;
		if (!layer) return;
		layer.setStyle(highlightStyle);
		if (layer instanceof L!.CircleMarker) layer.setRadius(8);
	}

	$effect(() => {
		const current = data;
		void fieldCropSeason;
		if (!L || !map) return;

		for (const layer of Object.values(featureLayers)) layer?.remove();
		featureLayers = {};
		featureLayerById.clear();
		featureBaseStyle.clear();
		highlighted = null;
		if (!current) return;

		const byType = new Map<AluType, AgriFeature[]>();
		for (const f of current.features) {
			const t = f.properties?.alu_type as AluType;
			if (!LAYER_BY_TYPE[t]) continue;
			if (!byType.has(t)) byType.set(t, []);
			byType.get(t)!.push(f);
		}

		for (const type of DRAW_ORDER) {
			const feats = byType.get(type);
			if (!feats?.length) continue;
			featureLayers[type] = buildTypeLayer(type, feats);
		}
		untrack(applyVisibility);
	});

	function applyVisibility() {
		if (!map) return;
		for (const type of DRAW_ORDER) {
			const layer = featureLayers[type];
			if (!layer) continue;
			if (visible[type]) {
				layer.addTo(map);
			} else if (map.hasLayer(layer)) {
				layer.remove();
			}
		}
		restack();
	}

	$effect(() => {
		for (const { type } of LAYERS) void visible[type];
		applyVisibility();
	});

	$effect(() => {
		void data;
		const id = selectedFeatureId;
		if (!L || !map) return;
		setHighlight(id ? (featureLayerById.get(id) ?? null) : null);
	});

	export function zoomToType(type: AluType) {
		const layer = featureLayers[type];
		if (!map || !layer) return;
		const bounds = layer.getBounds();
		if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 18 });
	}

	export function zoomToDistrict() {
		if (map && boundaryLayer) map.fitBounds(boundaryLayer.getBounds(), { padding: [20, 20] });
	}
</script>

<div class="tlab-map-host">
	<div class="tlab-map" bind:this={mapContainer}></div>
	{#if readout}
		<div class="tlab-readout" style:left="{readout.x + 14}px" style:top="{readout.y - 12}px">
			{@html readout.text}
		</div>
	{/if}
	{#if rasterError}
		<div class="tlab-raster-error">{rasterError}</div>
	{/if}
</div>

<style>
	.tlab-map-host {
		position: relative;
		width: 100%;
		height: 100%;
	}

	.tlab-readout {
		position: absolute;
		z-index: 1000;
		pointer-events: none;
		background: rgb(15 23 42 / 0.85);
		color: white;
		font-family: 'Montserrat', sans-serif;
		font-size: 0.72rem;
		padding: 0.2rem 0.45rem;
		border-radius: 0.3rem;
		white-space: nowrap;
	}

	.tlab-raster-error {
		position: absolute;
		z-index: 1000;
		top: 0.75rem;
		left: 50%;
		translate: -50% 0;
		background: #fef2f2;
		color: #b91c1c;
		font-family: 'Montserrat', sans-serif;
		font-size: 0.75rem;
		padding: 0.3rem 0.6rem;
		border-radius: 0.3rem;
	}

	:global(.tlab-raster-img),
	:global(.tlab-hydro-img) {
		image-rendering: pixelated;
	}

	:global(.leaflet-tooltip.tlab-wucs-label) {
		background: rgb(251 146 60 / 0.9);
		border: none;
		box-shadow: none;
		color: white;
		font-family: 'Montserrat', sans-serif;
		font-size: 0.68rem;
		font-weight: 700;
		padding: 0.1rem 0.4rem;
	}

	:global(.leaflet-tooltip.tlab-canal-tip) {
		font-family: 'Montserrat', sans-serif;
		font-size: 0.72rem;
		line-height: 1.4;
		color: #0f172a;
	}

	:global(.leaflet-tooltip.tlab-wucs-label::before) {
		display: none;
	}

	:global(.tlab-zoomed-out .leaflet-tooltip.tlab-wucs-label),
	:global(.tlab-zoomed-out .leaflet-tooltip.tlab-village-label) {
		display: none;
	}

	:global(.tlab-zooming .leaflet-tooltip-pane) {
		visibility: hidden;
	}

	:global(.leaflet-tooltip.tlab-village-label) {
		background: none;
		border: none;
		box-shadow: none;
		color: #f8fafc;
		font-family: 'Montserrat', sans-serif;
		font-size: 0.66rem;
		font-weight: 600;
		text-shadow: 0 0 3px #0f172a, 0 0 2px #0f172a;
		padding: 0;
	}

	:global(.leaflet-tooltip.tlab-village-label::before) {
		display: none;
	}

	/* Plot-level water budget open while zoomed in: rasters would tint the gaps between plots */
	:global(.tlab-plots-focus .leaflet-tlabRaster-pane),
	:global(.tlab-plots-focus .leaflet-tlabHydro-pane) {
		display: none;
	}

	.tlab-map {
		width: 100%;
		height: 100%;
		background: #0f172a;
	}
</style>
