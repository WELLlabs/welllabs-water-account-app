<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import TLabMap from '$lib/components/TLabMap.svelte';
	import TLabFeaturePanel from '$lib/components/TLabFeaturePanel.svelte';
	import TLabSection from '$lib/components/TLabSection.svelte';
	import TLabWaterPanel from '$lib/components/TLabWaterPanel.svelte';
	import TLabEtPanel from '$lib/components/TLabEtPanel.svelte';
	import TLabSmPanel from '$lib/components/TLabSmPanel.svelte';
	import TLabCropPanel from '$lib/components/TLabCropPanel.svelte';
	import TLabWaterControls, { type WaterCropSource } from '$lib/components/TLabWaterControls.svelte';
	import TLabMapHud from '$lib/components/TLabMapHud.svelte';
	import { fmt, fmtAcres } from '$lib/components/cropcalc/format';
	import { TLabWater, WATER_PALETTE, seasonParts } from '$lib/tlabWater.svelte';
	import { SM_BREAKS, SM_LUT, SM_PALETTE, TLabSoil, smColor, smFromByte } from '$lib/tlabSoil.svelte';
	import { FOCUS_BREAKS, TLabCrops, coverageOpacity, cropText, fmtHa, focusRamp, primaryKn } from '$lib/tlabCrops.svelte';
	import { TLabGapi } from '$lib/tlabGapi.svelte';
	import {
		LAYERS,
		DPRVI_BASE,
		CANAL_TYPES,
		ET_COLORS,
		PCP_COLORS,
		NPP_COLORS,
		TBP_COLORS,
		GBWP_COLORS,
		cropColor,
		fieldSeasonCrop,
		formatAcres,
		formatCropLabel,
		geometryCenter,
		monthRange,
		type EtPoint,
		type AgriCellResponse,
		type AgriFeature,
		type AluType
	} from '$lib/tlab';
	import { TLabWaporLayer } from '$lib/tlabWapor.svelte';

	let grid = $state<GeoJSON.FeatureCollection | null>(null);
	let boundary = $state<GeoJSON.FeatureCollection | null>(null);
	let geometryError = $state<string | null>(null);

	let selectedCellId = $state<string | null>(null);
	let data = $state<AgriCellResponse | null>(null);
	let loading = $state(false);
	let fetchError = $state<string | null>(null);
	let includeNonAg = $state(true);

	let visible = $state<Record<AluType, boolean>>({
		field: true,
		dug_well: true,
		farm_pond: true,
		other_water: true,
		trees: true
	});
	let showBoundary = $state(true);
	let showGrid = $state(true);
	let canals = $state.raw<GeoJSON.FeatureCollection | null>(null);
	let showCanals = $state(true);

	let openSec = $state({
		water: true,
		landscape: false,
		et: false,
		etWapor: false,
		pcp: false,
		npp: false,
		tbp: false,
		gbwp: false,
		sm: false,
		crops: false,
		boundaries: false,
		villages: false,
		canals: false,
		grid: false
	});


	let selectedFeature = $state.raw<AgriFeature | null>(null);

	let wucs = $state.raw<GeoJSON.FeatureCollection | null>(null);
	let showWucs = $state(true);

	const CANAL_KEY = [1, 3, 4, 5].map((t) => CANAL_TYPES[t]);

	const boundariesOn = $derived(showBoundary || (wucs != null && showWucs));
	function setBoundaries(on: boolean) {
		showBoundary = on;
		showWucs = on;
	}

	type LayerSource = { label: string; href?: string };
	const AGRI_SOURCE: LayerSource = {
		label: 'Google Agricultural Understanding API',
		href: 'https://developers.google.com/agricultural-understanding/api'
	};
	const SOURCES: Record<string, LayerSource[]> = {
		water: [AGRI_SOURCE, { label: 'WELL Labs crop water budgets (CSV)', href: '/total_water_needed.csv' }],
		landscape: [AGRI_SOURCE],
		et: [
			{
				label: 'NRSC/ISRO Bhuvan NHP actual evapotranspiration (SNPP-VIIRS)',
				href: 'https://bhuvan.nrsc.gov.in/nhpgs/nhp_evapotranspiration/wms'
			}
		],
		etWapor: [
			{
				label: 'FAO WaPOR v3 Level 1 actual evapotranspiration and interception (L1-AETI-M)',
				href: 'https://www.fao.org/in-action/remote-sensing-for-water-productivity/wapor/en'
			}
		],
		pcp: [
			{
				label: 'FAO WaPOR v3 Level 1 precipitation (L1-PCP-M, CHIRPS)',
				href: 'https://www.fao.org/in-action/remote-sensing-for-water-productivity/wapor/en'
			},
			{ label: 'CHIRPS (Climate Hazards Center)', href: 'https://www.chc.ucsb.edu/data/chirps' }
		],
		npp: [
			{
				label: 'FAO WaPOR v3 Level 1 net primary production (L1-NPP-M)',
				href: 'https://www.fao.org/in-action/remote-sensing-for-water-productivity/wapor/en'
			}
		],
		tbp: [
			{
				label: 'FAO WaPOR v3 Level 1 total biomass production (L1-TBP-A)',
				href: 'https://www.fao.org/in-action/remote-sensing-for-water-productivity/wapor/en'
			}
		],
		gbwp: [
			{
				label: 'FAO WaPOR v3 Level 1 gross biomass water productivity (L1-GBWP-A)',
				href: 'https://www.fao.org/in-action/remote-sensing-for-water-productivity/wapor/en'
			}
		],
		sm: [
			{
				label: 'Sentinel-1 RTC (10 m) on Microsoft Planetary Computer',
				href: 'https://planetarycomputer.microsoft.com/dataset/sentinel-1-rtc'
			},
			{ label: 'WELL Labs relative soil moisture (change detection); not published as a public product' }
		],
		crops: [
			{ label: 'Karnataka crop survey (Dept. of Agriculture)', href: 'https://cropsurvey.karnataka.gov.in/' },
			{ label: 'WELL Labs Raichur FRUITS scrape (raichur_raw on S3); not a public catalog' },
			{ label: 'KGIS cadastral maps (KSRSAC)', href: 'https://kgis.ksrsac.in/kgismaps2/rest/services/CadastralData_Admin/Dynamic_CadastralData_Admin/MapServer' }
		],
		villages: [
			{ label: 'KGIS village boundaries (KSRSAC)', href: 'https://kgis.ksrsac.in/kgismaps2/rest/services/CadastralData_Admin/Dynamic_CadastralData_Admin/MapServer/4' }
		],
		boundaries: [{ label: 'WELL Labs project files (Raichur_DT.geojson, TLBC D-95 WUCS boundary); not published online' }],
		canals: [
			{ label: 'WELL Labs project file (Raichur_Canal.gpkg); not published online' },
			{ label: 'canal types per India-WRIS', href: 'https://indiawris.gov.in/wris/' }
		],
		grid: [{ label: 'S2 Geometry, level 13 (the Google API’s cell grid)', href: 'https://s2geometry.io/devguide/s2cell_hierarchy' }]
	};
	const RESOLUTION: Record<string, string> = {
		water: 'S2 level 13 (~1.3 km); plot outlines from Google ALU',
		landscape: 'Field polygons in the selected S2 level-13 cell',
		et: '750 m, monthly (SNPP-VIIRS energy balance)',
		etWapor: '300 m, monthly (WaPOR v3 L1-AETI-M)',
		pcp: '~5 km, monthly (WaPOR v3 L1-PCP-M / CHIRPS)',
		npp: '300 m, monthly (WaPOR v3 L1-NPP-M)',
		tbp: '300 m, annual (WaPOR v3 L1-TBP-A)',
		gbwp: '300 m, annual (WaPOR v3 L1-GBWP-A)',
		sm: '250 m (from 10 m Sentinel-1 RTC)',
		crops: 'Survey-number extents from raichur_raw on S3; parcels after a cell click',
		boundaries: 'Vector (district / WUCS)',
		villages: 'KGIS village polygons',
		canals: 'Vector (India-WRIS canal types)',
		grid: 'S2 level 13 (~1.3 km)'
	};

	const water = new TLabWater();
	const npp = new TLabWaporLayer('npp', 'month');
	const tbp = new TLabWaporLayer('tbp', 'year');
	const gbwp = new TLabWaporLayer('gbwp', 'year');
	onDestroy(() => {
		water.destroy();
		etSeriesController?.abort();
		waporSeriesController?.abort();
		pcpSeriesController?.abort();
		npp.abort();
		tbp.abort();
		gbwp.abort();
	});
	let waterPanelHidden = $state(false);
	let waterCropSource = $state<WaterCropSource>('gapi');
	onMount(() => void water.load());

	/** Data layers colour the whole district, so only one is shown at a time */
	/** Flip to restore the NRSC Bhuvan ET sidebar layer (API still lives in api/hydro.py). */
	const SHOW_NRSC_ET = false;
	type DataLayer = 'water' | 'landscape' | 'et' | 'etWapor' | 'pcp' | 'npp' | 'tbp' | 'gbwp' | 'sm' | 'crops';
	let dataLayer = $state<DataLayer | null>('water');
	const showWater = $derived(dataLayer === 'water');
	const showLandscape = $derived(dataLayer === 'landscape');
	const showEt = $derived(dataLayer === 'et');
	const showEtWapor = $derived(dataLayer === 'etWapor');
	const showPcp = $derived(dataLayer === 'pcp');
	const showNpp = $derived(dataLayer === 'npp');
	const showTbp = $derived(dataLayer === 'tbp');
	const showGbwp = $derived(dataLayer === 'gbwp');
	const showSm = $derived(dataLayer === 'sm');
	const showCrops = $derived(dataLayer === 'crops');
	const hydroLayers = ['et', 'etWapor', 'pcp', 'npp', 'tbp', 'gbwp'] as const;

	function setDataLayer(layer: DataLayer, on: boolean) {
		dataLayer = on ? layer : dataLayer === layer ? null : dataLayer;
		if (dataLayer !== 'landscape') selectedFeature = null;
		if (!on) return;
		for (const k of ['water', 'landscape', 'et', 'etWapor', 'pcp', 'npp', 'tbp', 'gbwp', 'sm', 'crops'] as const)
			openSec[k] = k === layer;
		if ((hydroLayers as readonly string[]).includes(layer)) etPanelHidden = false;
		if (layer === 'water' && water.status === 'error') void water.load();
	}

	const waterFromGapi = $derived(showWater && waterCropSource === 'gapi');
	const waterFromSurvey = $derived(showWater && waterCropSource === 'survey');
	const waterFills = $derived(waterFromGapi && water.totals ? water.fills : null);
	const waterCellShown = $derived(waterFromGapi && selectedCellId != null && water.cellId === selectedCellId);
	const waterPlots = $derived(waterCellShown ? water.processed : null);
	const mapVisible = $derived.by(() => {
		const out = { ...visible };
		for (const l of LAYERS) out[l.type] = showLandscape && visible[l.type];
		return out;
	});
	$effect(() => {
		const id = selectedCellId;
		if (!waterFromGapi || !id || !boundary || !water.cellIds.has(id)) return;
		untrack(() => {
			if (water.cellId === id) return;
			waterPanelHidden = false;
			void water.loadCell(id, boundary!);
		});
	});

	function waterTooltip(id: string): string | null {
		const m3 = water.byCell.get(id);
		if (m3 == null) return null;
		return `<strong>${fmt(m3)} m³</strong> · ${water.seasonKey}<br><span style="color:#64748b">Click for plot-level water budget</span>`;
	}

	/** Map click on a plot: its crop group in Crop level view, otherwise the plot itself */
	function selectWaterPlot(id: string) {
		selectedFeature = null;
		waterPanelHidden = false;
		if (water.viewMode === 'group') {
			const crop = water.plots.find((p) => p.id === id)?.crop ?? null;
			water.selectedCrop = water.selectedCrop === crop ? null : crop;
			return;
		}
		water.viewMode = 'plot';
		water.selectedCrop = null;
		water.selectedPlot = id;
	}

	function runWaterExport(task: () => void) {
		try {
			task();
		} catch (e) {
			reportError(e instanceof Error ? e.message : 'Export failed.');
		}
	}


	function formatDay(iso: string): string {
		return new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		});
	}

	let etRange = $state<{ first: string; latest: string } | null>(null);
	let etRangeError = $state<string | null>(null);
	let etIdx = $state(0);
	let etOpacity = $state(0.7);
	const etMonths = $derived(etRange ? monthRange(etRange.first, etRange.latest) : []);
	const etMonth = $derived(etMonths[etIdx] ?? null);

	let etSeries = $state.raw<EtPoint[] | null>(null);
	let etSeriesLoading = $state(false);
	let etSeriesError = $state<string | null>(null);
	let etSeriesKey = '';
	let etSeriesController: AbortController | null = null;

	const soil = new TLabSoil();
	let smPanelHidden = $state(false);
	let smOpacity = $state(0.85);
	/** Slider position while dragging; the map pass is committed on release */
	let smIdx = $state(0);
	$effect(() => {
		smIdx = soil.idx;
	});

	function formatMonth(ym: string): string {
		return new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
	}

	function formatPeriod(period: string): string {
		return period.length === 4 ? period : formatMonth(period);
	}

	function fmtTbp(v: number): string {
		return Math.round(v).toLocaleString('en-IN');
	}

	function stepEt(delta: number) {
		etIdx = Math.min(etMonths.length - 1, Math.max(0, etIdx + delta));
	}

	let waporRange = $state<{ first: string; latest: string } | null>(null);
	let waporRangeError = $state<string | null>(null);
	let waporIdx = $state(0);
	let waporOpacity = $state(0.7);
	const waporMonths = $derived(waporRange ? monthRange(waporRange.first, waporRange.latest) : []);
	const waporMonth = $derived(waporMonths[waporIdx] ?? null);

	let waporSeries = $state.raw<EtPoint[] | null>(null);
	let waporSeriesLoading = $state(false);
	let waporSeriesError = $state<string | null>(null);
	let waporSeriesKey = '';
	let waporSeriesController: AbortController | null = null;

	function stepWapor(delta: number) {
		waporIdx = Math.min(waporMonths.length - 1, Math.max(0, waporIdx + delta));
	}

	let pcpRange = $state<{ first: string; latest: string } | null>(null);
	let pcpRangeError = $state<string | null>(null);
	let pcpIdx = $state(0);
	let pcpOpacity = $state(0.7);
	const pcpMonths = $derived(pcpRange ? monthRange(pcpRange.first, pcpRange.latest) : []);
	const pcpMonth = $derived(pcpMonths[pcpIdx] ?? null);

	let pcpSeries = $state.raw<EtPoint[] | null>(null);
	let pcpSeriesLoading = $state(false);
	let pcpSeriesError = $state<string | null>(null);
	let pcpSeriesKey = '';
	let pcpSeriesController: AbortController | null = null;

	function stepPcp(delta: number) {
		pcpIdx = Math.min(pcpMonths.length - 1, Math.max(0, pcpIdx + delta));
	}

	function setSmIdx(i: number) {
		soil.idx = Math.min(soil.passes.length - 1, Math.max(0, i));
	}

	const cellCenter = $derived.by(() => {
		if (!selectedCellId || !grid) return null;
		const f = grid.features.find((g) => g.properties?.cellId === selectedCellId);
		const c = f ? geometryCenter(f.geometry) : null;
		return c ? { lat: c[0], lng: c[1] } : null;
	});

	async function loadEtSeries(lat: number, lng: number, first: string, latest: string) {
		etSeriesController?.abort();
		const ctrl = new AbortController();
		etSeriesController = ctrl;
		etSeriesLoading = true;
		etSeriesError = null;
		etSeries = null;
		try {
			const params = new URLSearchParams({
				lat: lat.toFixed(5),
				lng: lng.toFixed(5),
				start: first,
				end: latest
			});
			const res = await fetch(`/fwa-api/hydro/et/series?${params}`, { signal: ctrl.signal, cache: 'no-store' });
			const body = await res.json().catch(() => null);
			if (!res.ok) throw new Error(errorMessage(res.status, body));
			if (etSeriesController !== ctrl) return;
			const series = body.series as EtPoint[];
			etSeries = series;
			if (etIdx === etMonths.length - 1) {
				const lastOk = [...series].reverse().find((p) => p.value != null);
				const idx = lastOk ? etMonths.indexOf(lastOk.month) : -1;
				if (idx >= 0) etIdx = idx;
			}
		} catch (e) {
			if (ctrl.signal.aborted) return;
			etSeriesError = e instanceof Error ? e.message : String(e);
			etSeriesKey = '';
		} finally {
			if (etSeriesController === ctrl) etSeriesLoading = false;
		}
	}

	$effect(() => {
		if (!cellCenter) {
			etSeriesController?.abort();
			etSeriesKey = '';
			etSeries = null;
			etSeriesLoading = false;
			return;
		}
		if (!showEt || !etRange) return;
		const { lat, lng } = cellCenter;
		const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
		if (key === etSeriesKey) return;
		etSeriesKey = key;
		void loadEtSeries(lat, lng, etRange.first, etRange.latest);
	});

	async function loadWaporSeries(lat: number, lng: number, first: string, latest: string) {
		waporSeriesController?.abort();
		const ctrl = new AbortController();
		waporSeriesController = ctrl;
		waporSeriesLoading = true;
		waporSeriesError = null;
		waporSeries = null;
		try {
			const params = new URLSearchParams({
				lat: lat.toFixed(5),
				lng: lng.toFixed(5),
				start: first,
				end: latest
			});
			while (!ctrl.signal.aborted) {
				const res = await fetch(`/fwa-api/hydro/wapor/series?${params}`, {
					signal: ctrl.signal,
					cache: 'no-store'
				});
				const body = await res.json().catch(() => null);
				if (!res.ok) throw new Error(errorMessage(res.status, body));
				if (waporSeriesController !== ctrl) return;
				const series = body.series as EtPoint[];
				waporSeries = series;
				if (waporIdx === waporMonths.length - 1) {
					const lastOk = [...series].reverse().find((p) => p.value != null);
					const idx = lastOk ? waporMonths.indexOf(lastOk.month) : -1;
					if (idx >= 0) waporIdx = idx;
				}
				if (body.complete) break;
				await new Promise<void>((resolve, reject) => {
					const t = setTimeout(resolve, 2000);
					ctrl.signal.addEventListener(
						'abort',
						() => {
							clearTimeout(t);
							reject(new DOMException('Aborted', 'AbortError'));
						},
						{ once: true }
					);
				});
			}
		} catch (e) {
			if (ctrl.signal.aborted) return;
			waporSeriesError = e instanceof Error ? e.message : String(e);
			waporSeriesKey = '';
		} finally {
			if (waporSeriesController === ctrl) waporSeriesLoading = false;
		}
	}

	$effect(() => {
		if (!cellCenter) {
			waporSeriesController?.abort();
			waporSeriesKey = '';
			waporSeries = null;
			waporSeriesLoading = false;
			return;
		}
		if (!showEtWapor || !waporRange) {
			waporSeriesController?.abort();
			if (!showEtWapor) waporSeriesKey = '';
			return;
		}
		const { lat, lng } = cellCenter;
		const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
		if (key === waporSeriesKey) return;
		waporSeriesKey = key;
		void loadWaporSeries(lat, lng, waporRange.first, waporRange.latest);
	});

	async function loadPcpSeries(lat: number, lng: number, first: string, latest: string) {
		pcpSeriesController?.abort();
		const ctrl = new AbortController();
		pcpSeriesController = ctrl;
		pcpSeriesLoading = true;
		pcpSeriesError = null;
		pcpSeries = null;
		try {
			const params = new URLSearchParams({
				product: 'pcp',
				lat: lat.toFixed(5),
				lng: lng.toFixed(5),
				start: first,
				end: latest
			});
			while (!ctrl.signal.aborted) {
				const res = await fetch(`/fwa-api/hydro/wapor/series?${params}`, {
					signal: ctrl.signal,
					cache: 'no-store'
				});
				const body = await res.json().catch(() => null);
				if (!res.ok) throw new Error(errorMessage(res.status, body));
				if (pcpSeriesController !== ctrl) return;
				const series = body.series as EtPoint[];
				pcpSeries = series;
				if (pcpIdx === pcpMonths.length - 1) {
					const lastOk = [...series].reverse().find((p) => p.value != null);
					const idx = lastOk ? pcpMonths.indexOf(lastOk.month) : -1;
					if (idx >= 0) pcpIdx = idx;
				}
				if (body.complete) break;
				await new Promise<void>((resolve, reject) => {
					const t = setTimeout(resolve, 2000);
					ctrl.signal.addEventListener(
						'abort',
						() => {
							clearTimeout(t);
							reject(new DOMException('Aborted', 'AbortError'));
						},
						{ once: true }
					);
				});
			}
		} catch (e) {
			if (ctrl.signal.aborted) return;
			pcpSeriesError = e instanceof Error ? e.message : String(e);
			pcpSeriesKey = '';
		} finally {
			if (pcpSeriesController === ctrl) pcpSeriesLoading = false;
		}
	}

	$effect(() => {
		if (!cellCenter) {
			pcpSeriesController?.abort();
			pcpSeriesKey = '';
			pcpSeries = null;
			pcpSeriesLoading = false;
			return;
		}
		if (!showPcp || !pcpRange) {
			pcpSeriesController?.abort();
			if (!showPcp) pcpSeriesKey = '';
			return;
		}
		const { lat, lng } = cellCenter;
		const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
		if (key === pcpSeriesKey) return;
		pcpSeriesKey = key;
		void loadPcpSeries(lat, lng, pcpRange.first, pcpRange.latest);
	});

	$effect(() => {
		if (!cellCenter) {
			npp.stopSeries();
			return;
		}
		if (!showNpp || !npp.range) {
			npp.stopSeries(!showNpp);
			return;
		}
		npp.startSeries(cellCenter.lat, cellCenter.lng);
	});

	$effect(() => {
		if (!cellCenter) {
			tbp.stopSeries();
			return;
		}
		if (!showTbp || !tbp.range) {
			tbp.stopSeries(!showTbp);
			return;
		}
		tbp.startSeries(cellCenter.lat, cellCenter.lng);
	});

	$effect(() => {
		if (!cellCenter) {
			gbwp.stopSeries();
			return;
		}
		if (!showGbwp || !gbwp.range) {
			gbwp.stopSeries(!showGbwp);
			return;
		}
		gbwp.startSeries(cellCenter.lat, cellCenter.lng);
	});

	$effect(() => {
		if (showSm) untrack(() => void soil.load());
	});

	function smLabel(byte: number): string | null {
		const v = smFromByte(byte);
		return v == null ? null : `Soil wetness <strong>${v}%</strong>`;
	}

	const smCellValue = $derived(
		showSm && selectedCellId && soil.status === 'done' ? soil.cellValue(selectedCellId) : null
	);
	const crops = new TLabCrops();
	let cropPanelHidden = $state(false);
	$effect(() => {
		if (showCrops || waterFromSurvey) untrack(() => void crops.load());
	});
	const gapi = new TLabGapi();
	onDestroy(() => gapi.abort());
	$effect(() => {
		gapi.seasonKey = water.seasonKey;
	});
	$effect(() => {
		const on = showLandscape;
		const b = boundary;
		if (on && b) untrack(() => void gapi.load(b));
	});
	const cropFocus = $derived(crops.focus != null ? crops.groups[crops.focus] : null);
	/** Season picker: years, then the seasons that year has */
	const cropYears = $derived([...new Set(crops.seasons.map((s) => s.year))].sort((a, b) => b - a));
	const cropYearSeasons = $derived(crops.seasons.filter((s) => s.year === crops.season?.year));
	function setCropYear(year: number) {
		const same = crops.seasons.find((s) => s.year === year && s.kind === crops.season?.kind);
		crops.seasonKey = (same ?? crops.seasons.find((s) => s.year === year))?.key ?? crops.seasonKey;
	}
	function cropSeasonMatchingWater(key: string): string | null {
		const { season, year } = seasonParts(key);
		return (
			crops.seasons.find((s) => s.year === year && s.kind === season)?.key ??
			crops.seasons.find((s) => s.year === year)?.key ??
			null
		);
	}
	function waterSeasonMatchingCrop(year: number, kind: string): string | null {
		return water.seasons.find((s) => {
			const p = seasonParts(s.key);
			return p.year === year && p.season === kind;
		})?.key ?? null;
	}
	function setWaterCropSource(next: WaterCropSource) {
		waterCropSource = next;
		if (next === 'survey' && water.seasonKey) {
			const key = cropSeasonMatchingWater(water.seasonKey);
			if (key) crops.seasonKey = key;
		} else if (next === 'gapi' && crops.season) {
			const key = waterSeasonMatchingCrop(crops.season.year, crops.season.kind);
			if (key) water.setSeason(key);
		}
	}
	function setSurveyYear(year: number) {
		setCropYear(year);
		if (water.years.includes(year)) water.setYear(year);
	}
	function setSurveySeason(key: string) {
		crops.seasonKey = key;
		const s = crops.seasons.find((x) => x.key === key);
		if (!s) return;
		const match = waterSeasonMatchingCrop(s.year, s.kind);
		if (match) water.setSeason(match);
	}
	const surveyHudSeasons = $derived(cropYearSeasons.map((s) => ({ key: s.key, label: s.kind })));
	const surveyHudLegend = $derived(
		crops.district
			.filter((a) => !a.group.idle)
			.slice(0, 10)
			.map((a) => ({
				color: a.group.color,
				label: cropText(a.group),
				count: `${fmtHa(a.ha)} ha`
			}))
	);
	const landscapeYear = $derived(water.seasonKey ? seasonParts(water.seasonKey).year : null);
	const landscapeSeasons = $derived(
		(landscapeYear != null ? water.seasonsForYear(landscapeYear) : []).map((s) => {
			const p = seasonParts(s.key);
			return { key: s.key, label: `${p.season} · ${p.range}` };
		})
	);

	let villages = $state.raw<GeoJSON.FeatureCollection | null>(null);
	let showVillages = $state(true);
	$effect(() => {
		const g = grid;
		const v = villages;
		if (g && v) untrack(() => crops.bindCells(g, v));
	});
	const villageBoxes = $derived.by(() => {
		const out: [string, number, number, number, number][] = [];
		for (const f of villages?.features ?? []) {
			let [s, w, n, e] = [90, 180, -90, -180];
			const walk = (c: unknown): void => {
				if (typeof (c as number[])[0] !== 'number') {
					for (const d of c as unknown[]) walk(d);
					return;
				}
				const [x, y] = c as number[];
				[s, w, n, e] = [Math.min(s, y), Math.min(w, x), Math.max(n, y), Math.max(e, x)];
			};
			walk((f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon).coordinates);
			out.push([String(f.properties?.code), s, w, n, e]);
		}
		return out;
	});
	const selectedCellRing = $derived.by(() => {
		if (!selectedCellId || !grid) return null;
		const f = grid.features.find((g) => g.properties?.cellId === selectedCellId);
		const geom = f?.geometry;
		if (geom?.type === 'Polygon') return geom.coordinates[0] as [number, number][];
		if (geom?.type === 'MultiPolygon') return (geom.coordinates[0]?.[0] as [number, number][]) ?? null;
		return null;
	});
	const plotCodeKey = $derived.by(() => {
		if ((!showCrops && !waterFromSurvey) || crops.status !== 'done' || !selectedCellRing) return '';
		let s = 90,
			w = 180,
			n = -90,
			e = -180;
		for (const [x, y] of selectedCellRing) {
			s = Math.min(s, y);
			n = Math.max(n, y);
			w = Math.min(w, x);
			e = Math.max(e, x);
		}
		return villageBoxes
			.filter(([, vs, vw, vn, ve]) => vs <= n && vn >= s && vw <= e && ve >= w)
			.map(([code]) => code)
			.join(',');
	});
	const plotCodes = $derived(plotCodeKey ? plotCodeKey.split(',') : []);
	$effect(() => {
		const codes = plotCodes;
		if (codes.length) untrack(() => crops.loadPlots(codes));
	});
	const cropPlotsOn = $derived(
		Boolean(selectedCellId) && plotCodes.length > 0 && (showCrops || waterFromSurvey)
	);
	const cropPlots = $derived(cropPlotsOn ? crops.plotCollection(plotCodes, selectedCellRing) : null);
	const cropPlotFills = $derived(cropPlotsOn ? crops.plotFills(plotCodes) : new Map<string, string>());
	let selectedCropPlot = $state<string | null>(null);
	$effect(() => {
		if (!showCrops && !waterFromSurvey) selectedCropPlot = null;
	});
	const surveyHudNote = $derived(
		cropPlotsOn
			? 'Parcels take the colour of their largest crop.'
			: 'Colour is the largest crop; stronger fill where it covers more of the cell.'
	);

	const cellFills = $derived(
		waterFromGapi
			? waterFills
			: showLandscape
				? landscapeFills
				: (showCrops || waterFromSurvey) && crops.status === 'done' && crops.fills.size
					? crops.fills
					: null
	);
	const cellTooltip = (id: string) =>
		showCrops || waterFromSurvey ? crops.tooltip(id) : showLandscape ? landscapeTooltip(id) : waterTooltip(id);
	const smRaster = $derived(showSm ? soil.frame : null);
	let etPanelHidden = $state(false);
	const etCellValue = $derived(etMonth ? (etSeries?.find((p) => p.month === etMonth) ?? null) : null);
	const waporCellValue = $derived(
		waporMonth ? (waporSeries?.find((p) => p.month === waporMonth) ?? null) : null
	);
	const pcpCellValue = $derived(
		pcpMonth ? (pcpSeries?.find((p) => p.month === pcpMonth) ?? null) : null
	);
	$effect(() => {
		const f = selectedFeature;
		if (f && !visible[f.properties?.alu_type as AluType]) selectedFeature = null;
	});

	let mapRef = $state<TLabMap | null>(null);
	let controller: AbortController | null = null;
	let datesController: AbortController | null = null;

	let dates = $state<string[] | null>(null);
	let datesError = $state<string | null>(null);
	// index into `dates`; dates.length means the default consolidated map
	let snapIdx = $state(0);
	let loadedDate = $state<string | null>(null);

	const isLatest = $derived(!dates || snapIdx >= dates.length);
	const snapDate = $derived(isLatest ? null : dates![snapIdx]);

	function formatSnapDate(iso: string): string {
		return new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		});
	}

	const selectedToken = $derived.by(() => {
		if (!selectedCellId || !grid) return null;
		const f = grid.features.find((g) => g.properties?.cellId === selectedCellId);
		return (f?.properties?.id as string | undefined) ?? null;
	});

	const counts = $derived.by(() => {
		const out: Record<string, number> = {};
		for (const f of data?.features ?? []) {
			const t = f.properties?.alu_type;
			out[t] = (out[t] ?? 0) + 1;
		}
		return out;
	});

	const summary = $derived.by(() => {
		if (!data) return null;
		let fieldArea = 0;
		let withHistory = 0;
		for (const f of data.features) {
			if (f.properties?.alu_type !== 'field') continue;
			fieldArea += f.properties.area_sq_m ?? 0;
			if (f.properties.monitoring_prediction?.length) withHistory++;
		}
		return {
			fieldArea,
			fields: counts.field ?? 0,
			withHistory,
			wells: counts.dug_well ?? 0,
			ponds: counts.farm_pond ?? 0,
			total: data.features.length
		};
	});

	const landscapeCrops = $derived.by(() => {
		if (!data) return [];
		const counts = new Map<string, number>();
		for (const f of data.features) {
			if (f.properties?.alu_type !== 'field') continue;
			const crop = fieldSeasonCrop(f.properties.monitoring_prediction, water.seasonKey) ?? 'NO_PREDICTION';
			counts.set(crop, (counts.get(crop) ?? 0) + 1);
		}
		return [...counts]
			.sort((a, b) => b[1] - a[1])
			.map(([crop, n]) => ({ crop, n, label: formatCropLabel(crop), color: cropColor(crop) }));
	});
	/** Google ALU prominent crop in the selected cell, hectares of farm plots. */
	const landscapeMain = $derived.by(() => {
		if (!data) return null;
		const sums = new Map<string, number>();
		for (const f of data.features) {
			if (f.properties?.alu_type !== 'field') continue;
			const crop = fieldSeasonCrop(f.properties.monitoring_prediction, water.seasonKey);
			if (!crop) continue;
			sums.set(crop, (sums.get(crop) ?? 0) + (f.properties.area_sq_m ?? 0) / 10_000);
		}
		let crop = '';
		let ha = 0;
		for (const [c, a] of sums) {
			if (a > ha) {
				crop = c;
				ha = a;
			}
		}
		return crop ? { crop, ha } : null;
	});
	const landscapeFills = $derived.by(() => {
		if (!showLandscape) return null;
		const out = gapi.fills.size ? new Map(gapi.fills) : new Map<string, string>();
		if (selectedCellId && landscapeMain) out.set(selectedCellId, cropColor(landscapeMain.crop));
		return out.size ? out : null;
	});
	const landscapeOpacities = $derived.by(() => {
		if (!showLandscape) return null;
		const out = gapi.opacities.size ? new Map(gapi.opacities) : new Map<string, number>();
		if (selectedCellId && landscapeMain) out.set(selectedCellId, coverageOpacity(landscapeMain.ha));
		return out.size ? out : null;
	});
	function landscapeTooltip(id: string): string | null {
		if (id === selectedCellId && landscapeMain) {
			const pct = Math.min(100, Math.round((landscapeMain.ha / 125) * 100));
			return `<strong>${formatCropLabel(landscapeMain.crop)}</strong> · Google ALU<br><span style="color:#64748b">${formatCropLabel(landscapeMain.crop)} covers ${pct}% of the cell</span><br><span style="color:#64748b">Click a farm plot, well or pond</span>`;
		}
		return gapi.tooltip(id);
	}
	const landscapeHudLegend = $derived(
		landscapeCrops.length
			? landscapeCrops.slice(0, 8).map((r) => ({
					color: r.color,
					label: r.label,
					count: r.n.toLocaleString('en-IN')
				}))
			: gapi.district
					.filter((a) => a.crop !== 'Fallow' && a.crop !== 'Harvested')
					.slice(0, 8)
					.map((a) => ({
						color: cropColor(a.crop),
						label: a.crop,
						count: `${fmtHa(a.ha)} ha`
					}))
	);

	onMount(async () => {
		try {
			const [g, b] = await Promise.all([
				fetch('/tlab/raichur_s2_l13.geojson').then((r) => {
					if (!r.ok) throw new Error(`grid ${r.status}`);
					return r.json();
				}),
				fetch('/fwa-api/tlab/layers/boundary').then((r) => {
					if (!r.ok) throw new Error(`boundary ${r.status}`);
					return r.json();
				})
			]);
			grid = g;
			boundary = b;
		} catch (e) {
			geometryError = `Could not load the district grid (${e instanceof Error ? e.message : e}).`;
		}
	});

	onMount(async () => {
		fetch('/fwa-api/tlab/layers/canals')
			.then((r) => (r.ok ? r.json() : null))
			.then((c) => (canals = c))
			.catch(() => {});
		fetch('/fwa-api/tlab/layers/villages')
			.then((r) => (r.ok ? r.json() : null))
			.then((v) => (villages = v))
			.catch(() => {});
		wucs = await fetch(`${DPRVI_BASE}/wucs_boundary.geojson`)
			.then((r) => (r.ok ? r.json() : null))
			.catch(() => null);
	});

	let pageErrors = $state<string[]>([]);

	function reportError(message: string) {
		if (pageErrors.includes(message)) return;
		pageErrors = [...pageErrors, message].slice(-3);
		void fetch('/fwa-api/client-error', { method: 'POST', body: message }).catch(() => {});
	}

	onMount(() => {
		const onError = (e: ErrorEvent) => reportError(e.error?.stack ?? e.message);
		const onRejection = (e: PromiseRejectionEvent) =>
			reportError(e.reason instanceof Error ? (e.reason.stack ?? e.reason.message) : String(e.reason));
		window.addEventListener('error', onError);
		window.addEventListener('unhandledrejection', onRejection);
		return () => {
			window.removeEventListener('error', onError);
			window.removeEventListener('unhandledrejection', onRejection);
		};
	});

	onMount(async () => {
		if (SHOW_NRSC_ET) {
			try {
				const res = await fetch('/fwa-api/hydro/et/latest', { cache: 'no-store' });
				const body = await res.json().catch(() => null);
				if (!res.ok) throw new Error(errorMessage(res.status, body));
				etRange = body;
				etIdx = monthRange(body.first, body.latest).length - 1;
			} catch (e) {
				etRangeError = e instanceof Error ? e.message : String(e);
			}
		}
		try {
			const res = await fetch('/fwa-api/hydro/wapor/latest', { cache: 'no-store' });
			const body = await res.json().catch(() => null);
			if (!res.ok) throw new Error(errorMessage(res.status, body));
			waporRange = body;
			waporIdx = monthRange(body.first, body.latest).length - 1;
		} catch (e) {
			waporRangeError = e instanceof Error ? e.message : String(e);
		}
		try {
			const res = await fetch('/fwa-api/hydro/wapor/latest?product=pcp', { cache: 'no-store' });
			const body = await res.json().catch(() => null);
			if (!res.ok) throw new Error(errorMessage(res.status, body));
			pcpRange = body;
			pcpIdx = monthRange(body.first, body.latest).length - 1;
		} catch (e) {
			pcpRangeError = e instanceof Error ? e.message : String(e);
		}
		void npp.loadLatest();
		void tbp.loadLatest();
		void gbwp.loadLatest();
	});

	function errorMessage(status: number, body: unknown): string {
		const detail = (body as { detail?: unknown })?.detail;
		if (detail && typeof detail === 'object') {
			const d = detail as { status?: number; message?: string };
			if (d.status === 429) return 'Google API rate limit reached — try again in a minute.';
			return d.message ?? `Upstream error (${d.status ?? status})`;
		}
		if (typeof detail === 'string') return detail;
		return `Request failed (${status})`;
	}

	async function loadCell(cellId: string, date: string | null = null) {
		controller?.abort();
		const ctrl = new AbortController();
		controller = ctrl;
		const keepId = selectedFeature?.id != null ? String(selectedFeature.id) : null;
		loading = true;
		fetchError = null;
		data = null;
		selectedFeature = null;
		try {
			const params = new URLSearchParams({ nonAg: String(includeNonAg) });
			if (date) params.set('date', date);
			const res = await fetch(`/fwa-api/agri/cell/${cellId}?${params}`, {
				signal: ctrl.signal,
				cache: 'no-store'
			});
			const body = await res.json().catch(() => null);
			if (!res.ok) throw new Error(errorMessage(res.status, body));
			if (controller !== ctrl) return;
			data = body as AgriCellResponse;
			loadedDate = date;
			if (keepId) selectedFeature = data.features.find((f) => String(f.id) === keepId) ?? null;
		} catch (e) {
			if (ctrl.signal.aborted) return;
			fetchError = e instanceof Error ? e.message : String(e);
		} finally {
			if (controller === ctrl) loading = false;
		}
	}

	async function loadDates(cellId: string) {
		datesController?.abort();
		const ctrl = new AbortController();
		datesController = ctrl;
		dates = null;
		datesError = null;
		snapIdx = 0;
		try {
			const res = await fetch(`/fwa-api/agri/cell/${cellId}/dates`, {
				signal: ctrl.signal,
				cache: 'no-store'
			});
			const body = await res.json().catch(() => null);
			if (!res.ok) throw new Error(errorMessage(res.status, body));
			if (datesController !== ctrl) return;
			dates = (body?.dates as string[]) ?? [];
			snapIdx = dates.length;
		} catch (e) {
			if (ctrl.signal.aborted) return;
			datesError = e instanceof Error ? e.message : String(e);
		}
	}

	function selectCell(cellId: string) {
		if (cellId === selectedCellId && (data || loading)) return;
		selectedCellId = cellId;
		selectedCropPlot = null;
		etPanelHidden = false;
		smPanelHidden = false;
		cropPanelHidden = false;
		loadedDate = null;
		void loadCell(cellId);
		void loadDates(cellId);
	}

	function clearCell() {
		controller?.abort();
		controller = null;
		datesController?.abort();
		datesController = null;
		selectedCellId = null;
		data = null;
		dates = null;
		datesError = null;
		loadedDate = null;
		selectedFeature = null;
		selectedCropPlot = null;
		loading = false;
		fetchError = null;
		water.clearCell();
		mapRef?.zoomToDistrict();
	}

	function toggleNonAg() {
		includeNonAg = !includeNonAg;
		if (selectedCellId) void loadCell(selectedCellId, snapDate);
	}

	function commitSnapshot() {
		if (!selectedCellId || snapDate === loadedDate) return;
		void loadCell(selectedCellId, snapDate);
	}

	function stepSnapshot(delta: number) {
		if (!dates) return;
		const next = Math.min(dates.length, Math.max(0, snapIdx + delta));
		if (next === snapIdx) return;
		snapIdx = next;
		commitSnapshot();
	}
</script>

<svelte:head>
	<title>T-Lab · Farm Water Accounting</title>
</svelte:head>

{#snippet sources(key: string)}
	<div class="tlab-cite">
		<p class="tlab-source">
			<span>Resolution</span>
			<span>{RESOLUTION[key]}</span>
		</p>
		<p class="tlab-source">
			<span>Source</span>
			{#each SOURCES[key] as s, i}
				{#if i}<span aria-hidden="true">·</span>{/if}
				{#if s.href}
					<a href={s.href} target="_blank" rel="noopener noreferrer">{s.label}</a>
				{:else}
					<span>{s.label}</span>
				{/if}
			{/each}
		</p>
	</div>
{/snippet}

<div class="tlab">
	<aside class="tlab-side">
		<div class="tlab-block">
			<h1>T-Lab · Raichur</h1>
			<p class="tlab-muted">
				Field-level landscape, crop, irrigation and water-balance layers. Select a grid cell to load
				its plots live.
			</p>
		</div>

		<div class="tlab-block">
			<div class="tlab-label">Selected cell</div>
			{#if selectedCellId}
				<div class="tlab-cell">
					<div>
						<div class="tlab-cell-id">{selectedToken ?? selectedCellId}</div>
						<div class="tlab-muted tlab-xs">S2 level 13 · {selectedCellId}</div>
					</div>
					<button type="button" class="tlab-link" onclick={clearCell}>Clear</button>
				</div>
			{:else}
				<p class="tlab-muted">No cell selected. Zoom in and click any square inside the district.</p>
			{/if}

			{#if loading}
				<p class="tlab-status">Loading cell data…</p>
			{:else if fetchError}
				<p class="tlab-status tlab-error">{fetchError}</p>
			{/if}
			{#each data?.warnings ?? [] as w}
				<p class="tlab-status tlab-warn">{w}</p>
			{/each}

			{#if summary}
				<dl class="tlab-summary tlab-mt">
					<div><dt>Farm plots</dt><dd>{summary.fields.toLocaleString('en-IN')}</dd></div>
					<div><dt>Farmed area</dt><dd>{formatAcres(summary.fieldArea)}</dd></div>
					<div><dt>With crop history</dt><dd>{summary.withHistory.toLocaleString('en-IN')}</dd></div>
					<div><dt>Wells · ponds</dt><dd>{summary.wells} · {summary.ponds}</dd></div>
				</dl>
			{/if}

			{#if selectedCellId}
				<div class="tlab-snap">
					<div class="tlab-snap-head">
						<span class="tlab-snap-title">Boundary snapshot</span>
						<strong>
							{#if !dates}…{:else if isLatest}Latest (combined){:else}{formatSnapDate(snapDate!)}{/if}
						</strong>
					</div>
					{#if datesError}
						<p class="tlab-muted tlab-xs">Snapshot dates unavailable: {datesError}</p>
					{:else if dates && dates.length}
						<div class="tlab-snap-row">
							<button
								type="button"
								class="tlab-step"
								aria-label="Previous snapshot"
								disabled={snapIdx <= 0}
								onclick={() => stepSnapshot(-1)}>‹</button
							>
							<input
								type="range"
								min="0"
								max={dates.length}
								step="1"
								aria-label="Boundary snapshot date"
								bind:value={snapIdx}
								onchange={commitSnapshot}
							/>
							<button
								type="button"
								class="tlab-step"
								aria-label="Next snapshot"
								disabled={snapIdx >= dates.length}
								onclick={() => stepSnapshot(1)}>›</button
							>
						</div>
						<div class="tlab-snap-ends tlab-xs tlab-muted">
							<span>{dates[0].slice(0, 4)}</span>
							<span>{dates.length} snapshots</span>
							<span>Latest</span>
						</div>
						<p class="tlab-muted tlab-xs tlab-mt">
							{#if isLatest}
								Combined map built from all snapshots. Drag back to see the landscape on a single
								capture date.
							{:else}
								Outlines as captured on this date. Crop history is shown for plots whose outline
								still matches today's.
							{/if}
						</p>
					{:else if dates}
						<p class="tlab-muted tlab-xs">No historical snapshots for this cell.</p>
					{/if}
				</div>
			{/if}

			<label class="tlab-check tlab-mt">
				<input type="checkbox" checked={includeNonAg} onchange={toggleNonAg} />
				<span>Include non-agricultural areas</span>
			</label>
		</div>

		<div class="tlab-group-label">Data layers <span class="tlab-group-hint">one at a time</span></div>

		<TLabSection
			title="Water budget"
			subtitle="Crop water need per grid cell · whole district"
			swatch="linear-gradient(135deg, {WATER_PALETTE[1]}, {WATER_PALETTE[4]})"
			exclusive
			on={showWater}
			onToggle={(v) => setDataLayer('water', v)}
			bind:open={openSec.water}
		>
			{#if water.status === 'loading'}
				<p class="tlab-muted tlab-xs">Loading…</p>
			{:else if water.status === 'error'}
				<p class="tlab-status tlab-error">
					{water.error}
					<button type="button" class="tlab-link" onclick={() => water.load()}>Try again</button>
				</p>
			{:else if water.generatedAt}
				<p class="tlab-muted tlab-xs">
					Crops detected on {new Date(water.generatedAt).toLocaleDateString('en-IN', {
						day: 'numeric',
						month: 'short',
						year: 'numeric'
					})}, totalled with the crop water budgets. Pick year, season and crop source on the map; click a cell for its plots.
				</p>
			{/if}
			{#if water.failedCells > 0}
				<p class="tlab-status tlab-warn">{fmt(water.failedCells)} cells had no data at that time and are left uncoloured.</p>
			{/if}

			{#if water.totals}
				<div class="tlab-water-exports tlab-mt">
					<span class="tlab-xs tlab-muted">Export</span>
					<button type="button" class="tlab-link" onclick={() => runWaterExport(() => water.downloadCellsCsv())}>Cells CSV</button>
				</div>

				<div class="tlab-subcard">
					<div class="tlab-subcard-title">Selected cell</div>
					{#if !selectedCellId}
						<p class="tlab-muted tlab-xs">Click a cell to see its plots by crop, overall and individual plot.</p>
					{:else if !showWater}
						<p class="tlab-muted tlab-xs">Select this layer to see this cell's water budget.</p>
					{:else if waterFromSurvey}
						<p class="tlab-muted tlab-xs">
							Grid colouring uses the crop survey. Click a cell for cadastral parcels; switch to Google ALU for water need in m³.
						</p>
					{:else if !water.cellIds.has(selectedCellId)}
						<p class="tlab-muted tlab-xs">No water budget for this cell.</p>
					{:else if water.cellLoading}
						<p class="tlab-muted tlab-xs">Loading plots…</p>
					{:else}
						<dl class="tlab-summary">
							<div><dt>Water needed</dt><dd>{fmt(water.byCell.get(selectedCellId) ?? 0)} <span class="tlab-unit">m³</span></dd></div>
							{#if water.cellTotals}
								<div><dt>Farm area</dt><dd>{fmtAcres(water.cellTotals.acres)} <span class="tlab-unit">ac</span></dd></div>
							{/if}
						</dl>
						{#if waterPanelHidden || selectedFeature}
							<button type="button" class="tlab-link tlab-mt" onclick={() => { waterPanelHidden = false; selectedFeature = null; }}>
								Open plot-level water budget
							</button>
						{/if}
					{/if}
				</div>
			{/if}
			{@render sources('water')}
		</TLabSection>

		<TLabSection
			title="Field landscape"
			subtitle="Google Agricultural Understanding · selected cell"
			swatch={LAYERS[0].color}
			exclusive
			on={showLandscape}
			onToggle={(v) => setDataLayer('landscape', v)}
			bind:open={openSec.landscape}
		>
			{#if !selectedCellId}
				<p class="tlab-muted tlab-xs">Click a cell to load its farm plots, wells, ponds and trees with crop history.</p>
			{/if}
			<ul class="tlab-layers">
				{#each LAYERS as layer}
					{@const n = counts[layer.type] ?? 0}
					<li>
						<input
							type="checkbox"
							aria-label={`Show ${layer.label}`}
							bind:checked={visible[layer.type]}
						/>
						<span class="tlab-swatch-lg" style:background={layer.color}></span>
						<button
							type="button"
							class="tlab-layer-name"
							disabled={!n || !showLandscape}
							title={n ? `Zoom to ${layer.label.toLowerCase()}` : undefined}
							onclick={() => mapRef?.zoomToType(layer.type)}
						>
							{layer.label}
						</button>
						<span class="tlab-count">{data ? n.toLocaleString('en-IN') : '–'}</span>
					</li>
				{/each}
			</ul>
			<p class="tlab-muted tlab-xs tlab-mt">
				{#if gapi.status === 'loading' && gapi.total}
					Loading Google ALU crops… {gapi.done.toLocaleString('en-IN')} of {gapi.total.toLocaleString('en-IN')} cells.
				{:else if data}
					Farm plots take Google's predicted crop. Grid colour is the largest Google ALU crop in the cell; stronger fill
					where it covers more of the cell.
				{:else}
					Each cell takes the colour of its largest Google ALU crop. Stronger fill means that crop covers more of the
					cell (~125 ha). Click a cell for farm plots, wells and ponds.
				{/if}
			</p>
			{@render sources('landscape')}
		</TLabSection>

		{#if SHOW_NRSC_ET}
		<TLabSection
			title="Evapotranspiration"
			subtitle="NRSC Bhuvan NHP · monthly actual ET, 750 m"
			swatch="linear-gradient(135deg, #ffffa0, #47de31, #203a77)"
			exclusive
			on={showEt}
			onToggle={(v) => setDataLayer('et', v)}
			bind:open={openSec.et}
		>
			{#if etRangeError}
				<p class="tlab-status tlab-error">ET service unavailable: {etRangeError}</p>
			{:else if !etRange || !etMonth}
				<p class="tlab-muted tlab-xs">Checking latest ET layer…</p>
			{:else}
				<div class="tlab-snap-head">
					<span class="tlab-snap-title">Month</span>
					<strong>{formatMonth(etMonth)}</strong>
				</div>
				<div class="tlab-snap-row">
					<button
						type="button"
						class="tlab-step"
						aria-label="Previous ET month"
						disabled={etIdx <= 0}
						onclick={() => stepEt(-1)}>‹</button
					>
					<input
						type="range"
						min="0"
						max={etMonths.length - 1}
						step="1"
						aria-label="ET month"
						bind:value={etIdx}
					/>
					<button
						type="button"
						class="tlab-step"
						aria-label="Next ET month"
						disabled={etIdx >= etMonths.length - 1}
						onclick={() => stepEt(1)}>›</button
					>
				</div>
				<div class="tlab-snap-ends tlab-xs tlab-muted">
					<span>{etRange.first.slice(0, 4)}</span>
					<span>{etRange.latest.slice(0, 4)}</span>
				</div>

				<div class="tlab-legend tlab-mt">
					<div class="tlab-classes">
						{#each ET_COLORS as c}<span style:background={c}></span>{/each}
					</div>
					<div class="tlab-legend-ticks tlab-xs tlab-muted">
						<span>0</span><span>5</span><span>10 mm/day</span>
					</div>
				</div>
				<label class="tlab-opacity tlab-mt">
					<span class="tlab-xs tlab-muted">Opacity</span>
					<input type="range" min="0.1" max="1" step="0.05" bind:value={etOpacity} />
				</label>

				<div class="tlab-subcard">
					<div class="tlab-subcard-title">Selected cell</div>
					{#if !selectedCellId}
						<p class="tlab-muted tlab-xs">Click a cell for its ET value and monthly history.</p>
					{:else if !showEt}
						<p class="tlab-muted tlab-xs">Select this layer to load this cell's ET.</p>
					{:else if etSeriesLoading}
						<p class="tlab-muted tlab-xs">Loading ET history for this cell…</p>
					{:else if etSeriesError}
						<p class="tlab-status tlab-error">{etSeriesError}</p>
					{:else if etSeries}
						<dl class="tlab-summary">
							<div>
								<dt>Cell ET</dt>
								<dd>
									{#if etCellValue?.value != null}
										{etCellValue.value.toFixed(2)} <span class="tlab-unit">mm/day</span>
									{:else}
										<span class="tlab-unit">{etCellValue?.status === 'cloud' ? 'Cloud' : 'No data'}</span>
									{/if}
								</dd>
							</div>
						</dl>
						{#if etPanelHidden}
							<button type="button" class="tlab-link tlab-mt" onclick={() => (etPanelHidden = false)}>
								Open ET stats and time series
							</button>
						{/if}
					{/if}
				</div>
				<p class="tlab-muted tlab-xs tlab-mt">
					NRSC Bhuvan National Hydrology Project actual ET (SNPP-VIIRS energy balance), monthly mean of
					daily AET at 750 m.
				</p>
			{/if}
			{@render sources('et')}
		</TLabSection>
		{/if}

		<TLabSection
			title="Evapotranspiration"
			subtitle="FAO WaPOR v3 · monthly AETI, 300 m"
			swatch="linear-gradient(135deg, #ffffa0, #47de31, #203a77)"
			exclusive
			on={showEtWapor}
			onToggle={(v) => setDataLayer('etWapor', v)}
			bind:open={openSec.etWapor}
		>
			{#if waporRangeError}
				<p class="tlab-status tlab-error">WaPOR ET unavailable: {waporRangeError}</p>
			{:else if !waporRange || !waporMonth}
				<p class="tlab-muted tlab-xs">Checking latest WaPOR layer…</p>
			{:else}
				<div class="tlab-snap-head">
					<span class="tlab-snap-title">Month</span>
					<strong>{formatMonth(waporMonth)}</strong>
				</div>
				<div class="tlab-snap-row">
					<button
						type="button"
						class="tlab-step"
						aria-label="Previous WaPOR ET month"
						disabled={waporIdx <= 0}
						onclick={() => stepWapor(-1)}>‹</button
					>
					<input
						type="range"
						min="0"
						max={waporMonths.length - 1}
						step="1"
						aria-label="WaPOR ET month"
						bind:value={waporIdx}
					/>
					<button
						type="button"
						class="tlab-step"
						aria-label="Next WaPOR ET month"
						disabled={waporIdx >= waporMonths.length - 1}
						onclick={() => stepWapor(1)}>›</button
					>
				</div>
				<div class="tlab-snap-ends tlab-xs tlab-muted">
					<span>{waporRange.first.slice(0, 4)}</span>
					<span>{waporRange.latest.slice(0, 4)}</span>
				</div>

				<div class="tlab-legend tlab-mt">
					<div class="tlab-classes">
						{#each ET_COLORS as c}<span style:background={c}></span>{/each}
					</div>
					<div class="tlab-legend-ticks tlab-xs tlab-muted">
						<span>0</span><span>5</span><span>10 mm/day</span>
					</div>
				</div>
				<label class="tlab-opacity tlab-mt">
					<span class="tlab-xs tlab-muted">Opacity</span>
					<input type="range" min="0.1" max="1" step="0.05" bind:value={waporOpacity} />
				</label>

				<div class="tlab-subcard">
					<div class="tlab-subcard-title">Selected cell</div>
					{#if !selectedCellId}
						<p class="tlab-muted tlab-xs">Click a cell for its ET value and monthly history.</p>
					{:else if !showEtWapor}
						<p class="tlab-muted tlab-xs">Select this layer to load this cell's WaPOR ET.</p>
					{:else if waporSeriesLoading && !waporSeries}
						<p class="tlab-muted tlab-xs">Loading WaPOR ET history for this cell…</p>
					{:else if waporSeriesError}
						<p class="tlab-status tlab-error">{waporSeriesError}</p>
					{:else if waporSeries}
						<dl class="tlab-summary">
							<div>
								<dt>Cell ET</dt>
								<dd>
									{#if waporCellValue?.value != null}
										{waporCellValue.value.toFixed(2)} <span class="tlab-unit">mm/day</span>
									{:else}
										<span class="tlab-unit">{waporCellValue?.status === 'cloud' ? 'Cloud' : 'No data'}</span>
									{/if}
								</dd>
							</div>
						</dl>
						{#if waporSeriesLoading}
							<p class="tlab-muted tlab-xs tlab-mt">Filling older months from WaPOR…</p>
						{/if}
						{#if etPanelHidden}
							<button type="button" class="tlab-link tlab-mt" onclick={() => (etPanelHidden = false)}>
								Open ET stats and time series
							</button>
						{/if}
					{/if}
				</div>
				<p class="tlab-muted tlab-xs tlab-mt">
					FAO WaPOR v3 Level 1 actual evapotranspiration and interception (L1-AETI-M), 300 m, monthly
					total converted to mm/day. India is not in the 100 m Level 2 countries.
				</p>
			{/if}
			{@render sources('etWapor')}
		</TLabSection>

		<TLabSection
			title="Precipitation"
			subtitle="FAO WaPOR v3 · monthly CHIRPS, ~5 km"
			swatch="linear-gradient(135deg, {PCP_COLORS[1]}, {PCP_COLORS[5]}, {PCP_COLORS[9]})"
			exclusive
			on={showPcp}
			onToggle={(v) => setDataLayer('pcp', v)}
			bind:open={openSec.pcp}
		>
			{#if pcpRangeError}
				<p class="tlab-status tlab-error">WaPOR rainfall unavailable: {pcpRangeError}</p>
			{:else if !pcpRange || !pcpMonth}
				<p class="tlab-muted tlab-xs">Checking latest rainfall layer…</p>
			{:else}
				<div class="tlab-snap-head">
					<span class="tlab-snap-title">Month</span>
					<strong>{formatMonth(pcpMonth)}</strong>
				</div>
				<div class="tlab-snap-row">
					<button
						type="button"
						class="tlab-step"
						aria-label="Previous rainfall month"
						disabled={pcpIdx <= 0}
						onclick={() => stepPcp(-1)}>‹</button
					>
					<input
						type="range"
						min="0"
						max={pcpMonths.length - 1}
						step="1"
						aria-label="Rainfall month"
						bind:value={pcpIdx}
					/>
					<button
						type="button"
						class="tlab-step"
						aria-label="Next rainfall month"
						disabled={pcpIdx >= pcpMonths.length - 1}
						onclick={() => stepPcp(1)}>›</button
					>
				</div>
				<div class="tlab-snap-ends tlab-xs tlab-muted">
					<span>{pcpRange.first.slice(0, 4)}</span>
					<span>{pcpRange.latest.slice(0, 4)}</span>
				</div>

				<div class="tlab-legend tlab-mt">
					<div class="tlab-classes">
						{#each PCP_COLORS as c}<span style:background={c}></span>{/each}
					</div>
					<div class="tlab-legend-ticks tlab-xs tlab-muted">
						<span>0</span><span>100</span><span>300 mm</span>
					</div>
				</div>
				<label class="tlab-opacity tlab-mt">
					<span class="tlab-xs tlab-muted">Opacity</span>
					<input type="range" min="0.1" max="1" step="0.05" bind:value={pcpOpacity} />
				</label>

				<div class="tlab-subcard">
					<div class="tlab-subcard-title">Selected cell</div>
					{#if !selectedCellId}
						<p class="tlab-muted tlab-xs">Click a cell for its rainfall and monthly history.</p>
					{:else if !showPcp}
						<p class="tlab-muted tlab-xs">Select this layer to load this cell's rainfall.</p>
					{:else if pcpSeriesLoading && !pcpSeries}
						<p class="tlab-muted tlab-xs">Loading rainfall history for this cell…</p>
					{:else if pcpSeriesError}
						<p class="tlab-status tlab-error">{pcpSeriesError}</p>
					{:else if pcpSeries}
						<dl class="tlab-summary">
							<div>
								<dt>Cell rainfall</dt>
								<dd>
									{#if pcpCellValue?.value != null}
										{pcpCellValue.value.toFixed(0)} <span class="tlab-unit">mm</span>
									{:else}
										<span class="tlab-unit">No data</span>
									{/if}
								</dd>
							</div>
						</dl>
						{#if pcpSeriesLoading}
							<p class="tlab-muted tlab-xs tlab-mt">Filling older months from WaPOR…</p>
						{/if}
						{#if etPanelHidden}
							<button type="button" class="tlab-link tlab-mt" onclick={() => (etPanelHidden = false)}>
								Open rainfall stats and time series
							</button>
						{/if}
					{/if}
				</div>
				<p class="tlab-muted tlab-xs tlab-mt">
					FAO WaPOR v3 Level 1 precipitation (L1-PCP-M), monthly CHIRPS totals at about 5 km. Coarser
					than the 300 m ET layer.
				</p>
			{/if}
			{@render sources('pcp')}
		</TLabSection>

		<TLabSection
			title="Net primary production"
			subtitle="FAO WaPOR v3 · monthly NPP, 300 m"
			swatch="linear-gradient(135deg, {NPP_COLORS[1]}, {NPP_COLORS[5]}, {NPP_COLORS[9]})"
			exclusive
			on={showNpp}
			onToggle={(v) => setDataLayer('npp', v)}
			bind:open={openSec.npp}
		>
			{#if npp.rangeError}
				<p class="tlab-status tlab-error">WaPOR NPP unavailable: {npp.rangeError}</p>
			{:else if !npp.range || !npp.period}
				<p class="tlab-muted tlab-xs">Checking latest NPP layer…</p>
			{:else}
				<div class="tlab-snap-head">
					<span class="tlab-snap-title">Month</span>
					<strong>{formatPeriod(npp.period)}</strong>
				</div>
				<div class="tlab-snap-row">
					<button
						type="button"
						class="tlab-step"
						aria-label="Previous NPP month"
						disabled={npp.idx <= 0}
						onclick={() => npp.step(-1)}>‹</button
					>
					<input
						type="range"
						min="0"
						max={npp.periods.length - 1}
						step="1"
						aria-label="NPP month"
						bind:value={npp.idx}
					/>
					<button
						type="button"
						class="tlab-step"
						aria-label="Next NPP month"
						disabled={npp.idx >= npp.periods.length - 1}
						onclick={() => npp.step(1)}>›</button
					>
				</div>
				<div class="tlab-snap-ends tlab-xs tlab-muted">
					<span>{npp.range.first.slice(0, 4)}</span>
					<span>{npp.range.latest.slice(0, 4)}</span>
				</div>

				<div class="tlab-legend tlab-mt">
					<div class="tlab-classes">
						{#each NPP_COLORS as c}<span style:background={c}></span>{/each}
					</div>
					<div class="tlab-legend-ticks tlab-xs tlab-muted">
						<span>0</span><span>100</span><span>250 gC/m²</span>
					</div>
				</div>
				<label class="tlab-opacity tlab-mt">
					<span class="tlab-xs tlab-muted">Opacity</span>
					<input type="range" min="0.1" max="1" step="0.05" bind:value={npp.opacity} />
				</label>

				<div class="tlab-subcard">
					<div class="tlab-subcard-title">Selected cell</div>
					{#if !selectedCellId}
						<p class="tlab-muted tlab-xs">Click a cell for its NPP and monthly history.</p>
					{:else if !showNpp}
						<p class="tlab-muted tlab-xs">Select this layer to load this cell's NPP.</p>
					{:else if npp.seriesLoading && !npp.series}
						<p class="tlab-muted tlab-xs">Loading NPP history for this cell…</p>
					{:else if npp.seriesError}
						<p class="tlab-status tlab-error">{npp.seriesError}</p>
					{:else if npp.series}
						<dl class="tlab-summary">
							<div>
								<dt>Cell NPP</dt>
								<dd>
									{#if npp.cellValue?.value != null}
										{npp.cellValue.value.toFixed(1)} <span class="tlab-unit">gC/m²</span>
									{:else}
										<span class="tlab-unit">No data</span>
									{/if}
								</dd>
							</div>
						</dl>
						{#if npp.seriesLoading}
							<p class="tlab-muted tlab-xs tlab-mt">Filling older months from WaPOR…</p>
						{/if}
						{#if etPanelHidden}
							<button type="button" class="tlab-link tlab-mt" onclick={() => (etPanelHidden = false)}>
								Open NPP stats and time series
							</button>
						{/if}
					{/if}
				</div>
				<p class="tlab-muted tlab-xs tlab-mt">
					FAO WaPOR v3 Level 1 net primary production (L1-NPP-M), 300 m, monthly total in grams of carbon
					per square metre.
				</p>
			{/if}
			{@render sources('npp')}
		</TLabSection>

		<TLabSection
			title="Biomass"
			subtitle="FAO WaPOR v3 · annual TBP, 300 m"
			swatch="linear-gradient(135deg, {TBP_COLORS[1]}, {TBP_COLORS[5]}, {TBP_COLORS[9]})"
			exclusive
			on={showTbp}
			onToggle={(v) => setDataLayer('tbp', v)}
			bind:open={openSec.tbp}
		>
			{#if tbp.rangeError}
				<p class="tlab-status tlab-error">WaPOR biomass unavailable: {tbp.rangeError}</p>
			{:else if !tbp.range || !tbp.period}
				<p class="tlab-muted tlab-xs">Checking latest biomass layer…</p>
			{:else}
				<div class="tlab-snap-head">
					<span class="tlab-snap-title">Year</span>
					<strong>{formatPeriod(tbp.period)}</strong>
				</div>
				<div class="tlab-snap-row">
					<button
						type="button"
						class="tlab-step"
						aria-label="Previous biomass year"
						disabled={tbp.idx <= 0}
						onclick={() => tbp.step(-1)}>‹</button
					>
					<input
						type="range"
						min="0"
						max={tbp.periods.length - 1}
						step="1"
						aria-label="Biomass year"
						bind:value={tbp.idx}
					/>
					<button
						type="button"
						class="tlab-step"
						aria-label="Next biomass year"
						disabled={tbp.idx >= tbp.periods.length - 1}
						onclick={() => tbp.step(1)}>›</button
					>
				</div>
				<div class="tlab-snap-ends tlab-xs tlab-muted">
					<span>{tbp.range.first}</span>
					<span>{tbp.range.latest}</span>
				</div>

				<div class="tlab-legend tlab-mt">
					<div class="tlab-classes">
						{#each TBP_COLORS as c}<span style:background={c}></span>{/each}
					</div>
					<div class="tlab-legend-ticks tlab-xs tlab-muted">
						<span>0</span><span>10k</span><span>35k kg/ha</span>
					</div>
				</div>
				<label class="tlab-opacity tlab-mt">
					<span class="tlab-xs tlab-muted">Opacity</span>
					<input type="range" min="0.1" max="1" step="0.05" bind:value={tbp.opacity} />
				</label>

				<div class="tlab-subcard">
					<div class="tlab-subcard-title">Selected cell</div>
					{#if !selectedCellId}
						<p class="tlab-muted tlab-xs">Click a cell for its annual biomass and yearly history.</p>
					{:else if !showTbp}
						<p class="tlab-muted tlab-xs">Select this layer to load this cell's biomass.</p>
					{:else if tbp.seriesLoading && !tbp.series}
						<p class="tlab-muted tlab-xs">Loading biomass history for this cell…</p>
					{:else if tbp.seriesError}
						<p class="tlab-status tlab-error">{tbp.seriesError}</p>
					{:else if tbp.series}
						<dl class="tlab-summary">
							<div>
								<dt>Cell biomass</dt>
								<dd>
									{#if tbp.cellValue?.value != null}
										{fmtTbp(tbp.cellValue.value)} <span class="tlab-unit">kg/ha</span>
									{:else}
										<span class="tlab-unit">No data</span>
									{/if}
								</dd>
							</div>
						</dl>
						{#if tbp.seriesLoading}
							<p class="tlab-muted tlab-xs tlab-mt">Filling older years from WaPOR…</p>
						{/if}
						{#if etPanelHidden}
							<button type="button" class="tlab-link tlab-mt" onclick={() => (etPanelHidden = false)}>
								Open biomass stats and time series
							</button>
						{/if}
					{/if}
				</div>
				<p class="tlab-muted tlab-xs tlab-mt">
					FAO WaPOR v3 Level 1 total biomass production (L1-TBP-A), 300 m, dry matter for the calendar
					year. WaPOR does not publish a monthly TBP layer.
				</p>
			{/if}
			{@render sources('tbp')}
		</TLabSection>

		<TLabSection
			title="Water productivity"
			subtitle="FAO WaPOR v3 · annual GBWP, 300 m"
			swatch="linear-gradient(135deg, {GBWP_COLORS[1]}, {GBWP_COLORS[5]}, {GBWP_COLORS[9]})"
			exclusive
			on={showGbwp}
			onToggle={(v) => setDataLayer('gbwp', v)}
			bind:open={openSec.gbwp}
		>
			{#if gbwp.rangeError}
				<p class="tlab-status tlab-error">WaPOR productivity unavailable: {gbwp.rangeError}</p>
			{:else if !gbwp.range || !gbwp.period}
				<p class="tlab-muted tlab-xs">Checking latest productivity layer…</p>
			{:else}
				<div class="tlab-snap-head">
					<span class="tlab-snap-title">Year</span>
					<strong>{formatPeriod(gbwp.period)}</strong>
				</div>
				<div class="tlab-snap-row">
					<button
						type="button"
						class="tlab-step"
						aria-label="Previous productivity year"
						disabled={gbwp.idx <= 0}
						onclick={() => gbwp.step(-1)}>‹</button
					>
					<input
						type="range"
						min="0"
						max={gbwp.periods.length - 1}
						step="1"
						aria-label="Productivity year"
						bind:value={gbwp.idx}
					/>
					<button
						type="button"
						class="tlab-step"
						aria-label="Next productivity year"
						disabled={gbwp.idx >= gbwp.periods.length - 1}
						onclick={() => gbwp.step(1)}>›</button
					>
				</div>
				<div class="tlab-snap-ends tlab-xs tlab-muted">
					<span>{gbwp.range.first}</span>
					<span>{gbwp.range.latest}</span>
				</div>

				<div class="tlab-legend tlab-mt">
					<div class="tlab-classes">
						{#each GBWP_COLORS as c}<span style:background={c}></span>{/each}
					</div>
					<div class="tlab-legend-ticks tlab-xs tlab-muted">
						<span>0</span><span>1.5</span><span>4 kg/m³</span>
					</div>
				</div>
				<label class="tlab-opacity tlab-mt">
					<span class="tlab-xs tlab-muted">Opacity</span>
					<input type="range" min="0.1" max="1" step="0.05" bind:value={gbwp.opacity} />
				</label>

				<div class="tlab-subcard">
					<div class="tlab-subcard-title">Selected cell</div>
					{#if !selectedCellId}
						<p class="tlab-muted tlab-xs">Click a cell for its water productivity and yearly history.</p>
					{:else if !showGbwp}
						<p class="tlab-muted tlab-xs">Select this layer to load this cell's productivity.</p>
					{:else if gbwp.seriesLoading && !gbwp.series}
						<p class="tlab-muted tlab-xs">Loading productivity history for this cell…</p>
					{:else if gbwp.seriesError}
						<p class="tlab-status tlab-error">{gbwp.seriesError}</p>
					{:else if gbwp.series}
						<dl class="tlab-summary">
							<div>
								<dt>Cell GBWP</dt>
								<dd>
									{#if gbwp.cellValue?.value != null}
										{gbwp.cellValue.value.toFixed(2)} <span class="tlab-unit">kg/m³</span>
									{:else}
										<span class="tlab-unit">No data</span>
									{/if}
								</dd>
							</div>
						</dl>
						{#if gbwp.seriesLoading}
							<p class="tlab-muted tlab-xs tlab-mt">Filling older years from WaPOR…</p>
						{/if}
						{#if etPanelHidden}
							<button type="button" class="tlab-link tlab-mt" onclick={() => (etPanelHidden = false)}>
								Open productivity stats and time series
							</button>
						{/if}
					{/if}
				</div>
				<p class="tlab-muted tlab-xs tlab-mt">
					FAO WaPOR v3 Level 1 gross biomass water productivity (L1-GBWP-A), 300 m: kilograms of biomass
					per cubic metre of water consumed (AETI) over the year. Higher is more productive.
				</p>
			{/if}
			{@render sources('gbwp')}
		</TLabSection>

		<TLabSection
			title="Relative soil moisture"
			subtitle="Sentinel-1 radar · 250 m · every 6–12 days{soil.latest ? ` · to ${formatDay(soil.latest)}` : ''}"
			swatch="linear-gradient(135deg, {SM_PALETTE[1]}, {SM_PALETTE[4]}, {SM_PALETTE[7]})"
			exclusive
			on={showSm}
			onToggle={(v) => setDataLayer('sm', v)}
			bind:open={openSec.sm}
		>
			{#if soil.status === 'error'}
				<p class="tlab-status tlab-error">
					Relative soil moisture layer unavailable: {soil.error}
					<button type="button" class="tlab-link" onclick={() => soil.load()}>Try again</button>
				</p>
			{:else if soil.status !== 'done' || !soil.pass}
				<p class="tlab-muted tlab-xs">{showSm ? 'Loading Sentinel-1 relative soil moisture…' : 'Select this layer to load relative soil moisture.'}</p>
			{:else}
				<div class="tlab-snap-head">
					<span class="tlab-snap-title">Satellite pass</span>
					<input
						type="date"
						class="tlab-date"
						min={soil.first}
						max={soil.latest}
						value={soil.date}
						onchange={(e) => e.currentTarget.value && soil.setDate(e.currentTarget.value)}
					/>
				</div>
				<div class="tlab-snap-row">
					<button
						type="button"
						class="tlab-step"
						aria-label="Previous satellite pass"
						disabled={soil.idx <= 0}
						onclick={() => setSmIdx(soil.idx - 1)}>‹</button
					>
					<input
						type="range"
						min="0"
						max={soil.passes.length - 1}
						step="1"
						aria-label="Satellite pass"
						bind:value={smIdx}
						onchange={() => setSmIdx(smIdx)}
					/>
					<button
						type="button"
						class="tlab-step"
						aria-label="Next satellite pass"
						disabled={soil.idx >= soil.passes.length - 1}
						onclick={() => setSmIdx(soil.idx + 1)}>›</button
					>
				</div>
				<div class="tlab-snap-ends tlab-xs tlab-muted">
					<span>{soil.first?.slice(0, 4)}</span>
					<span>{soil.passes.length} passes</span>
					<span>{soil.latest?.slice(0, 4)}</span>
				</div>
				<p class="tlab-muted tlab-xs tlab-mt">
					This pass saw {Math.round(soil.pass.cover * 100)}% of the district; the rest shows the latest pass in the
					{soil.maxAgeDays} days before.
					{#if soil.pass.mean != null}District average <strong>{soil.pass.mean.toFixed(0)}%</strong>.{/if}
				</p>

				<div class="tlab-legend tlab-mt">
					<div class="tlab-classes">
						{#each SM_PALETTE as c}<span style:background={c}></span>{/each}
					</div>
					<div class="tlab-water-ticks tlab-xs tlab-muted">
						{#each SM_BREAKS as b, i}<span style:left="{((i + 1) / SM_PALETTE.length) * 100}%">{b}%</span>{/each}
					</div>
					<p class="tlab-muted tlab-xs">
						Relative surface wetness (top ~5 cm): 0% is the driest and 100% the wettest each spot has been since
						{soil.first?.slice(0, 4)}. Blank: towns, rock, open water.
					</p>
				</div>
				<label class="tlab-opacity tlab-mt">
					<span class="tlab-xs tlab-muted">Opacity</span>
					<input type="range" min="0.1" max="1" step="0.05" bind:value={smOpacity} />
				</label>

				<div class="tlab-subcard">
					<div class="tlab-subcard-title">Selected cell</div>
					{#if !selectedCellId}
						<p class="tlab-muted tlab-xs">Click a cell for its relative soil moisture stats and history.</p>
					{:else}
						<dl class="tlab-summary">
							<div>
								<dt>Cell soil wetness</dt>
								<dd>
									{#if smCellValue}
										<span class="tlab-sm-chip" style:background={smColor(smCellValue.value)}></span>
										{smCellValue.value}<span class="tlab-unit">%</span>
										{#if smCellValue.date !== soil.date}<span class="tlab-unit"> · {formatDay(smCellValue.date)}</span>{/if}
									{:else}<span class="tlab-unit">No data</span>{/if}
								</dd>
							</div>
						</dl>
						{#if smPanelHidden}
							<button type="button" class="tlab-link tlab-mt" onclick={() => (smPanelHidden = false)}>
								Open relative soil moisture stats and time series
							</button>
						{/if}
					{/if}
				</div>
				<p class="tlab-muted tlab-xs tlab-mt">
					Change detection on Sentinel-1 VV backscatter (10 m RTC from Planetary Computer, averaged to
					250 m). Wetness is relative to each spot's own dry–wet range, not a volumetric reading; crop
					canopy and flooded paddies also change the signal.
				</p>
			{/if}
			{@render sources('sm')}
		</TLabSection>

		<TLabSection
			title="Crop survey"
			subtitle="Karnataka crop survey · crop area per cell and parcel{crops.seasons.length ? ` · ${crops.seasons[0].label} to ${crops.seasons.at(-1)?.label}` : ''}"
			swatch="linear-gradient(135deg, #b45309, #db2777, #2563eb)"
			exclusive
			on={showCrops}
			onToggle={(v) => setDataLayer('crops', v)}
			bind:open={openSec.crops}
		>
			{#if crops.status === 'error'}
				<p class="tlab-status tlab-error">
					Crop survey layer unavailable: {crops.error}
					<button type="button" class="tlab-link" onclick={() => crops.load()}>Try again</button>
				</p>
			{:else if crops.status !== 'done' || !crops.season}
				<p class="tlab-muted tlab-xs">{showCrops ? 'Loading crop survey…' : 'Select this layer to load the crop survey.'}</p>
			{:else}
				<p class="tlab-muted tlab-xs">
					{#if crops.season.villages.total}
						{crops.season.villages.withData} of {crops.season.villages.total} villages ·
						{fmtHa(crops.districtTotal)} ha surveyed{#if crops.collecting}{' '}·
							still collecting{/if}
					{:else}
						Parcel records from the Raichur crop survey scrape. Click a cell to load them.
					{/if}
					Year, season and legend are on the map.
				</p>

				<div class="tlab-snap-head tlab-mt">
					<span class="tlab-snap-title">Colour cells by</span>
					<select
						class="tlab-date"
						aria-label="Colour cells by"
						value={crops.focus ?? ''}
						onchange={(e) => (crops.focus = e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
					>
						<option value="">Main crop</option>
						{#each crops.district.filter((a) => !a.group.idle) as a (a.group.id)}<option value={a.group.id}>{cropText(a.group)} area</option>{/each}
					</select>
				</div>

				{#if cropFocus}
					<div class="tlab-legend">
						<div class="tlab-classes">
							{#each focusRamp(cropFocus.color) as c}<span style:background={c}></span>{/each}
						</div>
						<div class="tlab-water-ticks tlab-xs tlab-muted">
							{#each FOCUS_BREAKS.slice(0, -1) as b, i}<span style:left="{((i + 1) / FOCUS_BREAKS.length) * 100}%">{b}</span>{/each}
						</div>
						<p class="tlab-muted tlab-xs">
							{#if cropPlotsOn}{cropText(cropFocus)} share of each parcel, lightest under 20% to darkest over 80%.{:else}{cropText(cropFocus)}, hectares per cell (about 1.3 km²).{/if}
						</p>
					</div>
				{:else}
					<ul class="tlab-crop-key tlab-xs">
						{#each crops.district.filter((a) => !a.group.idle).slice(0, 10) as a (a.group.id)}
							{@const kn = primaryKn(a.group)}
							<li>
								<button type="button" class="tlab-layer-name" onclick={() => (crops.focus = a.group.id)} title="Map {cropText(a.group)} area">
									<span class="tlab-swatch-lg" style:background={a.group.color}></span>
									<span class="tlab-crop-label">
										{#if kn}<span class="tlab-kn">{kn}</span>{/if}
										<span class="tlab-en">{a.group.name}</span>
									</span>
								</button>
								<span class="tlab-count">{fmtHa(a.ha)} ha</span>
							</li>
						{/each}
					</ul>
					<p class="tlab-muted tlab-xs">
						{#if cropPlotsOn}
							Each parcel takes the colour of its largest crop; click a crop to map its share.
						{:else}
							Each cell takes the colour of its largest crop. Stronger fill means that crop covers more of the
							cell (~125 ha). Click a cell to colour its parcels.
						{/if}
					</p>
				{/if}

				<p class="tlab-muted tlab-xs tlab-mt">
					{#if !selectedCellId}
						Click a grid cell to load its cadastral parcels and crop survey records.
					{:else if !plotCodes.length}
						No village cadastral map overlaps this cell.
					{:else if !crops.plotsLoaded(plotCodes)}
						Loading cadastral parcels and crop survey rows for this cell…
					{:else}
						Showing {cropPlots?.features.length.toLocaleString('en-IN') ?? 0} parcels in this cell.
						Click a parcel for its crops and year-by-year trend.
					{/if}
				</p>

				<div class="tlab-subcard">
					<div class="tlab-subcard-title">Selected cell</div>
					{#if !selectedCellId}
						<p class="tlab-muted tlab-xs">Click a cell for its crops this season and across every season.</p>
					{:else}
						{@const cellAreas =
							crops.plotsLoaded(plotCodes) && selectedCellRing
								? crops.plotCellAreas(plotCodes, selectedCellRing)
								: []}
						{@const main = crops.main(cellAreas)}
						<dl class="tlab-summary">
							<div>
								<dt>Main crop</dt>
								<dd>{#if main}<span class="tlab-sm-chip" style:background={main.group.color}></span>{cropText(main.group)}{:else}<span class="tlab-unit">No records</span>{/if}</dd>
							</div>
							<div>
								<dt>Surveyed</dt>
								<dd>{fmtHa(cellAreas.reduce((s, a) => s + a.ha, 0))} <span class="tlab-unit">ha</span></dd>
							</div>
						</dl>
					{/if}
				</div>
				{#if cropPanelHidden}
					<button type="button" class="tlab-link tlab-mt" onclick={() => (cropPanelHidden = false)}>Open crop survey stats</button>
				{/if}
				<p class="tlab-muted tlab-xs tlab-mt">
					Crops are the Raichur FRUITS scrape (raichur_raw on S3). Outlines are KGIS cadastral parcels.
					Pick a year and season on the map. Owner names are not kept.
				</p>
			{/if}
			{@render sources('crops')}
		</TLabSection>

		<div class="tlab-group-label">Overlays</div>

		<TLabSection
			title="Boundaries"
			subtitle="District outline{wucs ? ' · WUCS boundaries' : ''}"
			on={boundariesOn}
			onToggle={setBoundaries}
			bind:open={openSec.boundaries}
		>
			<label class="tlab-check">
				<input type="checkbox" bind:checked={showBoundary} />
				<span class="tlab-swatch-lg tlab-swatch-outline"></span>
				<span>District boundary</span>
			</label>
			{#if wucs}
				<label class="tlab-check">
					<input type="checkbox" bind:checked={showWucs} />
					<span class="tlab-swatch-lg tlab-swatch-wucs"></span>
					<span>TLBC D-95 WUCS boundaries</span>
				</label>
			{/if}
			{@render sources('boundaries')}
		</TLabSection>

		<TLabSection
			title="Villages"
			subtitle="Village boundaries{villages ? ` · ${villages.features.length.toLocaleString('en-IN')}` : ''}"
			swatch="#e2e8f0"
			on={showVillages}
			onToggle={(v) => (showVillages = v)}
			bind:open={openSec.villages}
		>
			<p class="tlab-muted tlab-xs">
				{villages ? 'Revenue village outlines; names appear when zoomed in.' : 'Loading village boundaries…'}
			</p>
			{@render sources('villages')}
		</TLabSection>

		<TLabSection
			title="Canals"
			subtitle="Canal network{canals ? ` · ${canals.features.length.toLocaleString('en-IN')} segments` : ''}"
			on={showCanals}
			onToggle={(v) => (showCanals = v)}
			bind:open={openSec.canals}
		>
			{#if canals}
				<ul class="tlab-canal-key tlab-xs tlab-muted">
					{#each CANAL_KEY as k}
						<li><span style:height="{k.weight}px" style:background={k.color}></span>{k.label}</li>
					{/each}
				</ul>
			{:else}
				<p class="tlab-muted tlab-xs">Loading canals…</p>
			{/if}
			{@render sources('canals')}
		</TLabSection>

		<TLabSection
			title="Grid"
			subtitle="S2 level-13 cells{grid ? ` · ${grid.features.length.toLocaleString('en-IN')}` : ''}"
			on={showGrid}
			onToggle={(v) => (showGrid = v)}
			bind:open={openSec.grid}
		>
			<p class="tlab-muted tlab-xs">Cell outlines. Cells stay clickable when the grid is hidden.</p>
			{@render sources('grid')}
		</TLabSection>

		{#if geometryError}
			<p class="tlab-status tlab-error">{geometryError}</p>
		{/if}
	</aside>

	<div class="tlab-map-wrap">
		<svelte:boundary onerror={(e) => reportError(e instanceof Error ? (e.stack ?? e.message) : String(e))}>
		<TLabMap
			bind:this={mapRef}
			{grid}
			{boundary}
			{data}
			{selectedCellId}
			visible={mapVisible}
			{showBoundary}
			{showGrid}
			{wucs}
			{showWucs}
			{canals}
			{showCanals}
			etMonth={showEt
				? etMonth
				: showEtWapor
					? waporMonth
					: showPcp
						? pcpMonth
						: showNpp
							? npp.period
							: showTbp
								? tbp.period
								: showGbwp
									? gbwp.period
									: null}
			etKind={showEt
				? 'nrsc'
				: showEtWapor
					? 'wapor'
					: showPcp
						? 'pcp'
						: showNpp
							? 'npp'
							: showTbp
								? 'tbp'
								: showGbwp
									? 'gbwp'
									: null}
			etOpacity={showEt
				? etOpacity
				: showEtWapor
					? waporOpacity
					: showPcp
						? pcpOpacity
						: showNpp
							? npp.opacity
							: showTbp
								? tbp.opacity
								: gbwp.opacity}
			{cellFills}
			cellFillOpacity={
				showLandscape
					? landscapeOpacities
					: (showCrops || waterFromSurvey) && crops.status === 'done' && !crops.focus
						? crops.fillOpacities
						: null
			}
			{cellTooltip}
			raster={smRaster}
			rasterLut={SM_LUT}
			rasterLabel={smLabel}
			rasterOpacity={smOpacity}
			{waterPlots}
			focusCover={showLandscape}
			waterPlotColors={water.plotColors}
			waterSelectedPlot={waterPlots ? water.selectedPlot : null}
			waterSelectedCrop={waterPlots && water.viewMode === 'group' ? water.selectedCrop : null}
			onWaterPlotSelect={selectWaterPlot}
			selectedFeatureId={selectedFeature?.id != null ? String(selectedFeature.id) : null}
			onCellSelect={selectCell}
			onFeatureSelect={(f) => (selectedFeature = f)}
			{villages}
			{showVillages}
			{cropPlots}
			{cropPlotFills}
			cropPlotTooltip={(pid) => crops.plotTooltip(pid)}
			{selectedCropPlot}
			fieldCropSeason={showLandscape ? water.seasonKey || null : null}
			onCropPlotSelect={(pid) => {
				selectedCropPlot = pid;
				cropPanelHidden = false;
				if (showCrops) openSec.crops = true;
			}}
		/>
			{#snippet failed(error, reset)}
				<div class="tlab-map-failed">
					<p>The map hit an error and stopped updating.</p>
					<pre class="tlab-map-failed-msg">{error instanceof Error ? error.message : String(error)}</pre>
					<button type="button" class="tlab-link" onclick={reset}>Reload map</button>
				</div>
			{/snippet}
		</svelte:boundary>
		{#if pageErrors.length}
			<div class="tlab-page-errors" role="alert">
				<div class="tlab-page-errors-head">
					<strong>Something went wrong in the page</strong>
					<button type="button" class="tlab-link" onclick={() => (pageErrors = [])}>Dismiss</button>
				</div>
				{#each pageErrors as msg}
					<pre>{msg}</pre>
				{/each}
			</div>
		{/if}
		{#if showWater && water.status === 'done'}
			<TLabWaterControls
				{water}
				source={waterCropSource}
				onSource={setWaterCropSource}
				surveyYears={cropYears}
				surveyYear={crops.season?.year ?? null}
				onSurveyYear={setSurveyYear}
				surveySeasons={surveyHudSeasons}
				surveySeasonKey={crops.seasonKey}
				onSurveySeason={setSurveySeason}
				surveyLegend={surveyHudLegend}
				surveyNote={surveyHudNote}
				surveyReady={crops.status === 'done'}
			/>
		{:else if showLandscape && water.status === 'done'}
			<TLabMapHud
				title="Field landscape"
				years={water.years}
				year={landscapeYear}
				onYear={(y) => water.setYear(y)}
				seasons={landscapeSeasons}
				seasonKey={water.seasonKey || null}
				onSeason={(k) => water.setSeason(k)}
				legendItems={landscapeHudLegend}
				legendNote={gapi.status === 'loading' && gapi.total
					? `Loading Google ALU crops… ${gapi.done.toLocaleString('en-IN')} of ${gapi.total.toLocaleString('en-IN')} cells.`
					: gapi.status === 'error'
						? `Google ALU crops unavailable: ${gapi.error}`
						: data
							? `Farm plots coloured by Google's predicted crop${water.seasonKey ? ` · ${water.seasonKey}` : ''}. Grid colour is the largest crop in the cell.`
							: 'Colour is the largest Google ALU crop; stronger fill where it covers more of the cell. Click a cell for farm plots.'}
			/>
		{:else if showCrops && crops.status === 'done' && crops.season}
			<TLabMapHud
				title="Crop survey"
				years={cropYears}
				year={crops.season.year}
				onYear={setCropYear}
				seasons={surveyHudSeasons}
				seasonKey={crops.seasonKey}
				onSeason={(k) => (crops.seasonKey = k)}
				legendItems={cropFocus ? [] : surveyHudLegend}
				rampColors={cropFocus ? focusRamp(cropFocus.color) : []}
				rampTicks={cropFocus ? FOCUS_BREAKS.slice(0, -1).map(String) : []}
				legendNote={cropFocus
					? cropPlotsOn
						? `${cropText(cropFocus)} share of each parcel.`
						: `${cropText(cropFocus)}, hectares per cell.`
					: surveyHudNote}
			>
				{#snippet extra()}
					<label class="grow">
						<span>Colour by</span>
						<select
							value={crops.focus ?? ''}
							onchange={(e) => (crops.focus = e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
						>
							<option value="">Main crop</option>
							{#each crops.district.filter((a) => !a.group.idle) as a (a.group.id)}
								<option value={a.group.id}>{cropText(a.group)} area</option>
							{/each}
						</select>
					</label>
				{/snippet}
			</TLabMapHud>
		{/if}
		{#if loading}
			<div class="tlab-map-loading">Fetching live data…</div>
		{:else if showLandscape && data && !selectedFeature}
			<div class="tlab-map-loading tlab-map-hint">Click a plot, well or pond for details</div>
		{/if}
	</div>

	{#if selectedFeature}
		<div class="tlab-panel-wrap">
			<svelte:boundary onerror={(e) => reportError(e instanceof Error ? (e.stack ?? e.message) : String(e))}>
				<TLabFeaturePanel
					feature={selectedFeature}
					cellToken={selectedToken}
					seasonKey={water.seasonKey || null}
					onClose={() => (selectedFeature = null)}
				/>
				{#snippet failed()}
					<p class="tlab-status tlab-error">Could not show this feature's details.</p>
				{/snippet}
			</svelte:boundary>
		</div>
	{:else if waterCellShown && !waterPanelHidden}
		<div class="tlab-panel-wrap">
			<svelte:boundary onerror={(e) => reportError(e instanceof Error ? (e.stack ?? e.message) : String(e))}>
				<TLabWaterPanel
					{water}
					cellToken={selectedToken}
					onClose={() => (waterPanelHidden = true)}
					onZoomPlot={(id) => mapRef?.zoomToWaterPlot(id)}
					onZoomCrop={(crop) => mapRef?.zoomToWaterCrop(crop)}
				/>
				{#snippet failed()}
					<p class="tlab-status tlab-error">Could not show this cell's water budget.</p>
				{/snippet}
			</svelte:boundary>
		</div>
	{:else if SHOW_NRSC_ET && showEt && selectedCellId && etRange && !etPanelHidden}
		<div class="tlab-panel-wrap">
			<svelte:boundary onerror={(e) => reportError(e instanceof Error ? (e.stack ?? e.message) : String(e))}>
				<TLabEtPanel
					cellToken={selectedToken}
					months={etMonths}
					series={etSeries}
					loading={etSeriesLoading}
					error={etSeriesError}
					bind:idx={etIdx}
					onClose={() => (etPanelHidden = true)}
				/>
				{#snippet failed()}
					<p class="tlab-status tlab-error">Could not show this cell's ET.</p>
				{/snippet}
			</svelte:boundary>
		</div>
	{:else if showPcp && selectedCellId && pcpRange && !etPanelHidden}
		<div class="tlab-panel-wrap">
			<svelte:boundary onerror={(e) => reportError(e instanceof Error ? (e.stack ?? e.message) : String(e))}>
				<TLabEtPanel
					cellToken={selectedToken}
					months={pcpMonths}
					series={pcpSeries}
					loading={pcpSeriesLoading}
					error={pcpSeriesError}
					bind:idx={pcpIdx}
					mode="rain"
					sourceNote="FAO WaPOR v3 L1-PCP-M (~5 km CHIRPS), monthly rainfall at the centre of this cell."
					onClose={() => (etPanelHidden = true)}
				/>
				{#snippet failed()}
					<p class="tlab-status tlab-error">Could not show this cell's rainfall.</p>
				{/snippet}
			</svelte:boundary>
		</div>
	{:else if showEtWapor && selectedCellId && waporRange && !etPanelHidden}
		<div class="tlab-panel-wrap">
			<svelte:boundary onerror={(e) => reportError(e instanceof Error ? (e.stack ?? e.message) : String(e))}>
				<TLabEtPanel
					cellToken={selectedToken}
					months={waporMonths}
					series={waporSeries}
					loading={waporSeriesLoading}
					error={waporSeriesError}
					bind:idx={waporIdx}
					sourceNote="FAO WaPOR v3 L1-AETI-M (300 m), monthly AETI converted to mm/day, sampled at the centre of this cell."
					onClose={() => (etPanelHidden = true)}
				/>
				{#snippet failed()}
					<p class="tlab-status tlab-error">Could not show this cell's WaPOR ET.</p>
				{/snippet}
			</svelte:boundary>
		</div>
	{:else if showNpp && selectedCellId && npp.range && !etPanelHidden}
		<div class="tlab-panel-wrap">
			<svelte:boundary onerror={(e) => reportError(e instanceof Error ? (e.stack ?? e.message) : String(e))}>
				<TLabEtPanel
					cellToken={selectedToken}
					months={npp.periods}
					series={npp.series}
					loading={npp.seriesLoading}
					error={npp.seriesError}
					bind:idx={npp.idx}
					mode="npp"
					sourceNote="FAO WaPOR v3 L1-NPP-M (300 m), monthly net primary production in gC/m², sampled at the centre of this cell."
					onClose={() => (etPanelHidden = true)}
				/>
				{#snippet failed()}
					<p class="tlab-status tlab-error">Could not show this cell's NPP.</p>
				{/snippet}
			</svelte:boundary>
		</div>
	{:else if showTbp && selectedCellId && tbp.range && !etPanelHidden}
		<div class="tlab-panel-wrap">
			<svelte:boundary onerror={(e) => reportError(e instanceof Error ? (e.stack ?? e.message) : String(e))}>
				<TLabEtPanel
					cellToken={selectedToken}
					months={tbp.periods}
					series={tbp.series}
					loading={tbp.seriesLoading}
					error={tbp.seriesError}
					bind:idx={tbp.idx}
					mode="biomass"
					sourceNote="FAO WaPOR v3 L1-TBP-A (300 m), annual total biomass production in kg dry matter per hectare, sampled at the centre of this cell."
					onClose={() => (etPanelHidden = true)}
				/>
				{#snippet failed()}
					<p class="tlab-status tlab-error">Could not show this cell's biomass.</p>
				{/snippet}
			</svelte:boundary>
		</div>
	{:else if showGbwp && selectedCellId && gbwp.range && !etPanelHidden}
		<div class="tlab-panel-wrap">
			<svelte:boundary onerror={(e) => reportError(e instanceof Error ? (e.stack ?? e.message) : String(e))}>
				<TLabEtPanel
					cellToken={selectedToken}
					months={gbwp.periods}
					series={gbwp.series}
					loading={gbwp.seriesLoading}
					error={gbwp.seriesError}
					bind:idx={gbwp.idx}
					mode="wp"
					sourceNote="FAO WaPOR v3 L1-GBWP-A (300 m), annual gross biomass water productivity in kg/m³, sampled at the centre of this cell."
					onClose={() => (etPanelHidden = true)}
				/>
				{#snippet failed()}
					<p class="tlab-status tlab-error">Could not show this cell's water productivity.</p>
				{/snippet}
			</svelte:boundary>
		</div>
	{:else if showSm && selectedCellId && soil.status === 'done' && !smPanelHidden}
		<div class="tlab-panel-wrap">
			<svelte:boundary onerror={(e) => reportError(e instanceof Error ? (e.stack ?? e.message) : String(e))}>
				<TLabSmPanel {soil} cellId={selectedCellId} cellToken={selectedToken} onClose={() => (smPanelHidden = true)} />
				{#snippet failed()}
					<p class="tlab-status tlab-error">Could not show this cell's relative soil moisture.</p>
				{/snippet}
			</svelte:boundary>
		</div>
	{:else if (showCrops || (waterFromSurvey && selectedCellId)) && crops.status === 'done' && crops.season && !cropPanelHidden}
		<div class="tlab-panel-wrap">
			<svelte:boundary onerror={(e) => reportError(e instanceof Error ? (e.stack ?? e.message) : String(e))}>
				<TLabCropPanel
					{crops}
					cellId={selectedCellId}
					cellToken={selectedToken}
					plotId={selectedCropPlot}
					{plotCodes}
					cellRing={selectedCellRing}
					onClearPlot={() => (selectedCropPlot = null)}
					onClose={() => (cropPanelHidden = true)}
				/>
				{#snippet failed()}
					<p class="tlab-status tlab-error">Could not show the crop survey statistics.</p>
				{/snippet}
			</svelte:boundary>
		</div>
	{/if}
</div>

<style>
	.tlab {
		display: flex;
		height: calc(100dvh - 3.6rem);
		font-family: 'Montserrat', sans-serif;
		color: #00296b;
	}

	.tlab-side {
		width: 19.5rem;
		flex-shrink: 0;
		overflow-y: auto;
		border-right: 1px solid color-mix(in srgb, #00296b 12%, white);
		background: #f8fafc;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.tlab-block {
		background: white;
		border: 1px solid color-mix(in srgb, #00296b 10%, white);
		border-radius: 0.6rem;
		padding: 0.85rem;
	}

	h1 {
		margin: 0 0 0.35rem;
		font-family: 'Josefin Sans', sans-serif;
		font-size: 1.3rem;
		font-weight: 700;
	}

	.tlab-muted {
		margin: 0;
		font-size: 0.8rem;
		line-height: 1.5;
		color: color-mix(in srgb, #00296b 65%, white);
	}

	.tlab-xs {
		font-size: 0.7rem;
	}

	.tlab-mt {
		margin-top: 0.6rem;
	}

	.tlab-label {
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: color-mix(in srgb, #00296b 55%, white);
		margin-bottom: 0.5rem;
	}

	.tlab-cell {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.tlab-cell-id {
		font-weight: 700;
		font-size: 0.95rem;
		word-break: break-all;
	}

	.tlab-link {
		font-size: 0.78rem;
		font-weight: 600;
		color: #1b75e0;
		background: none;
		border: none;
		cursor: pointer;
		padding: 0;
	}

	.tlab-link:hover {
		text-decoration: underline;
	}

	.tlab-snap {
		margin-top: 0.75rem;
		padding-top: 0.7rem;
		border-top: 1px solid color-mix(in srgb, #00296b 10%, white);
	}

	.tlab-snap-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.82rem;
		margin-bottom: 0.35rem;
	}

	.tlab-snap-title {
		font-size: 0.75rem;
		color: color-mix(in srgb, #00296b 65%, white);
	}

	.tlab-snap-row {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.tlab-snap-row input[type='range'] {
		flex: 1;
		min-width: 0;
		accent-color: #1b75e0;
		cursor: pointer;
	}

	.tlab-step {
		width: 1.6rem;
		height: 1.6rem;
		flex-shrink: 0;
		border-radius: 0.35rem;
		border: 1px solid color-mix(in srgb, #00296b 15%, white);
		background: white;
		color: #00296b;
		font-size: 1rem;
		line-height: 1;
		cursor: pointer;
	}

	.tlab-step:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.tlab-step:not(:disabled):hover {
		border-color: #1b75e0;
		color: #1b75e0;
	}

	.tlab-snap-ends {
		display: flex;
		justify-content: space-between;
		margin: 0.15rem 1.95rem 0;
	}


	.tlab-swatch-wucs {
		border: 2px dashed #fb923c;
		background: transparent;
	}

	.tlab-group-label {
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: color-mix(in srgb, #00296b 55%, white);
		margin: 0.25rem 0.2rem -0.35rem;
		flex-shrink: 0;
	}

	.tlab-group-hint {
		font-weight: 500;
		letter-spacing: 0;
		text-transform: none;
		margin-left: 0.3rem;
	}

	.tlab-cite {
		margin: 0.7rem 0 0;
		padding-top: 0.5rem;
		border-top: 1px dashed #00296b1a;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.tlab-source {
		display: flex;
		flex-wrap: wrap;
		gap: 0.15rem 0.3rem;
		margin: 0;
		font-size: 0.66rem;
		line-height: 1.4;
		color: #00296b99;
	}

	.tlab-source > span:first-child {
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.tlab-source a {
		color: #1b75e0;
		text-decoration: none;
	}

	.tlab-source a:hover {
		text-decoration: underline;
	}

	.tlab-water-exports {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.3rem 0.75rem;
	}

	.tlab-water-ticks {
		position: relative;
		height: 1rem;
		margin-top: 0.2rem;
	}

	.tlab-water-ticks span {
		position: absolute;
		translate: -50% 0;
	}

	.tlab-canal-key {
		list-style: none;
		margin: 0.1rem 0 0.4rem 1.6rem;
		padding: 0;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.2rem 0.6rem;
	}

	.tlab-canal-key li {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.tlab-canal-key li span {
		width: 1.1rem;
		border-radius: 999px;
		flex-shrink: 0;
	}

	.tlab-subcard {
		margin-top: 0.75rem;
		padding: 0.6rem 0.65rem;
		border-radius: 0.45rem;
		background: #f8fafc;
		border: 1px solid color-mix(in srgb, #00296b 8%, white);
	}

	.tlab-subcard-title {
		font-size: 0.66rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: color-mix(in srgb, #00296b 55%, white);
		margin-bottom: 0.4rem;
	}

	.tlab-classes {
		display: flex;
		height: 0.55rem;
		border-radius: 999px;
		overflow: hidden;
	}

	.tlab-classes span {
		flex: 1;
	}

	.tlab-unit {
		font-size: 0.72rem;
		font-weight: 500;
		color: color-mix(in srgb, #00296b 60%, white);
	}

	.tlab-sm-chip {
		display: inline-block;
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 0.15rem;
		box-shadow: inset 0 0 0 1px #cbd5e1;
		margin-right: 0.2rem;
		vertical-align: -0.05rem;
	}

	.tlab-crop-pick {
		display: flex;
		gap: 0.3rem;
	}

	.tlab-crop-key {
		list-style: none;
		margin: 0.4rem 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.tlab-crop-key li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.tlab-crop-key .tlab-swatch-lg {
		margin-right: 0.4rem;
		align-self: flex-start;
		margin-top: 0.2rem;
	}

	.tlab-crop-label {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		line-height: 1.2;
		min-width: 0;
	}

	.tlab-kn {
		font-weight: 600;
	}

	.tlab-en {
		font-size: 0.68rem;
		font-weight: 500;
		color: color-mix(in srgb, #00296b 55%, white);
	}

	.tlab-crop-key .tlab-layer-name {
		display: flex;
		align-items: flex-start;
	}

	.tlab-date {
		font: inherit;
		font-size: 0.78rem;
		color: #00296b;
		border: 1px solid color-mix(in srgb, #00296b 15%, white);
		border-radius: 0.3rem;
		padding: 0.1rem 0.3rem;
	}

	.tlab-legend-ticks {
		display: flex;
		justify-content: space-between;
		margin-top: 0.2rem;
	}

	.tlab-opacity {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.tlab-opacity input {
		flex: 1;
		accent-color: #1b75e0;
	}

	.tlab-check {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.82rem;
		cursor: pointer;
		padding: 0.2rem 0;
	}

	.tlab-status {
		margin: 0.6rem 0 0;
		font-size: 0.78rem;
		padding: 0.45rem 0.6rem;
		border-radius: 0.4rem;
		background: color-mix(in srgb, #1b75e0 10%, white);
	}

	.tlab-error {
		background: #fef2f2;
		color: #b91c1c;
	}

	.tlab-warn {
		background: #fffbeb;
		color: #92400e;
	}

	.tlab-layers {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.tlab-layers li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.25rem 0;
	}

	.tlab-swatch-lg {
		display: inline-block;
		width: 0.9rem;
		height: 0.9rem;
		border-radius: 0.2rem;
		flex-shrink: 0;
	}

	.tlab-swatch-outline {
		border: 2.5px solid #fde047;
		background: transparent;
	}

	.tlab-layer-name {
		flex: 1;
		text-align: left;
		font-size: 0.85rem;
		font-weight: 500;
		color: inherit;
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
	}

	.tlab-layer-name:not(:disabled):hover {
		color: #1b75e0;
		text-decoration: underline;
	}

	.tlab-layer-name:disabled {
		cursor: default;
	}

	.tlab-count {
		font-size: 0.78rem;
		font-variant-numeric: tabular-nums;
		color: color-mix(in srgb, #00296b 60%, white);
	}


	.tlab-summary {
		margin: 0;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.6rem;
	}

	.tlab-summary dt {
		font-size: 0.7rem;
		color: color-mix(in srgb, #00296b 60%, white);
	}

	.tlab-summary dd {
		margin: 0.1rem 0 0;
		font-weight: 700;
		font-size: 0.95rem;
	}

	.tlab-map-wrap {
		position: relative;
		flex: 1;
		min-width: 0;
	}

	.tlab-map-loading {
		position: absolute;
		top: 0.75rem;
		left: 50%;
		translate: -50% 0;
		z-index: 1000;
		background: white;
		color: #00296b;
		font-size: 0.8rem;
		font-weight: 600;
		padding: 0.4rem 0.85rem;
		border-radius: 999px;
		box-shadow: 0 2px 10px rgb(0 0 0 / 0.2);
	}

	.tlab-map-hint {
		font-weight: 500;
		color: color-mix(in srgb, #00296b 75%, white);
		pointer-events: none;
	}

	.tlab-panel-wrap {
		display: flex;
		min-height: 0;
	}

	.tlab-map-failed {
		position: absolute;
		inset: 0;
		display: grid;
		place-content: center;
		gap: 0.5rem;
		text-align: center;
		background: #f8fafc;
		font-size: 0.85rem;
	}

	.tlab-map-failed-msg {
		margin: 0;
		max-width: 32rem;
		white-space: pre-wrap;
		font-size: 0.75rem;
		color: #991b1b;
	}

	.tlab-page-errors {
		position: absolute;
		left: 0.75rem;
		right: 0.75rem;
		bottom: 2rem;
		z-index: 1100;
		max-height: 40%;
		overflow: auto;
		background: #fef2f2;
		color: #991b1b;
		border: 1px solid #fecaca;
		border-radius: 0.5rem;
		padding: 0.6rem 0.75rem;
		font-size: 0.78rem;
		box-shadow: 0 4px 16px rgb(0 0 0 / 0.2);
	}

	.tlab-page-errors-head {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.tlab-page-errors pre {
		margin: 0.4rem 0 0;
		white-space: pre-wrap;
		word-break: break-word;
		font-size: 0.7rem;
	}

	@media (max-width: 768px) {
		.tlab {
			flex-direction: column;
			height: auto;
		}

		.tlab-side {
			order: 3;
			width: 100%;
			border-right: none;
			border-top: 1px solid color-mix(in srgb, #00296b 12%, white);
		}

		.tlab-map-wrap {
			order: 1;
			height: 65dvh;
			flex: none;
		}

		.tlab-panel-wrap {
			order: 2;
		}
	}
</style>
