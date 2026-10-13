<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import TLabMap from '$lib/components/TLabMap.svelte';
	import TLabFeaturePanel from '$lib/components/TLabFeaturePanel.svelte';
	import TLabSection from '$lib/components/TLabSection.svelte';
	import TLabWaterPanel from '$lib/components/TLabWaterPanel.svelte';
	import TLabEtPanel from '$lib/components/TLabEtPanel.svelte';
	import TLabSmPanel from '$lib/components/TLabSmPanel.svelte';
	import TLabWaterControls from '$lib/components/TLabWaterControls.svelte';
	import { fmt, fmtAcres } from '$lib/components/cropcalc/format';
	import { TLabWater, WATER_PALETTE } from '$lib/tlabWater.svelte';
	import { SM_BREAKS, SM_LUT, SM_PALETTE, TLabSoil, smColor, smFromByte } from '$lib/tlabSoil.svelte';
	import {
		LAYERS,
		DPRVI_BASE,
		CANAL_TYPES,
		ET_COLORS,
		formatAcres,
		geometryCenter,
		monthRange,
		type EtPoint,
		type AgriCellResponse,
		type AgriFeature,
		type AluType
	} from '$lib/tlab';

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
		sm: false,
		boundaries: false,
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
			{ label: 'NRSC Bhuvan-NHP actual ET (750 m)', href: 'https://bhuvan.nrsc.gov.in/nhp/webgis-et/map' },
			{ label: 'product note (PDF)', href: 'https://bhuvan.nrsc.gov.in/nhpfs/pdf/ET_750m.pdf' }
		],
		sm: [
			{ label: 'ESA Copernicus Sentinel-1', href: 'https://www.esa.int/Applications/Observing_the_Earth/Copernicus/Sentinel-1' },
			{ label: 'Sentinel-1 RTC on Microsoft Planetary Computer', href: 'https://planetarycomputer.microsoft.com/dataset/sentinel-1-rtc' },
			{ label: 'method: Copernicus Sentinel-1 soil moisture', href: 'https://land.copernicus.eu/en/products/soil-moisture/daily-surface-soil-moisture-v1.0' }
		],
		boundaries: [{ label: 'WELL Labs project files (Raichur_DT.geojson, TLBC D-95 WUCS boundary); not published online' }],
		canals: [
			{ label: 'WELL Labs project file (Raichur_Canal.gpkg); not published online' },
			{ label: 'canal types per India-WRIS', href: 'https://indiawris.gov.in/wris/' }
		],
		grid: [{ label: 'S2 Geometry, level 13 (the Google API’s cell grid)', href: 'https://s2geometry.io/devguide/s2cell_hierarchy' }]
	};

	const water = new TLabWater();
	onDestroy(() => water.destroy());
	let waterPanelHidden = $state(false);
	onMount(() => void water.load());

	/** Data layers colour the whole district, so only one is shown at a time */
	type DataLayer = 'water' | 'landscape' | 'et' | 'sm';
	let dataLayer = $state<DataLayer | null>('water');
	const showWater = $derived(dataLayer === 'water');
	const showLandscape = $derived(dataLayer === 'landscape');
	const showEt = $derived(dataLayer === 'et');
	const showSm = $derived(dataLayer === 'sm');

	function setDataLayer(layer: DataLayer, on: boolean) {
		dataLayer = on ? layer : dataLayer === layer ? null : dataLayer;
		if (dataLayer !== 'landscape') selectedFeature = null;
		if (!on) return;
		for (const k of ['water', 'landscape', 'et', 'sm'] as const) openSec[k] = k === layer;
		if (layer === 'water' && water.status === 'error') void water.load();
	}

	const waterFills = $derived(showWater && water.totals ? water.fills : null);
	const waterCellShown = $derived(showWater && selectedCellId != null && water.cellId === selectedCellId);
	const waterPlots = $derived(waterCellShown ? water.processed : null);
	const mapVisible = $derived.by(() => {
		const out = { ...visible };
		for (const l of LAYERS) out[l.type] = showLandscape && visible[l.type];
		return out;
	});
	$effect(() => {
		const id = selectedCellId;
		if (!showWater || !id || !boundary || !water.cellIds.has(id)) return;
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

	function stepEt(delta: number) {
		etIdx = Math.min(etMonths.length - 1, Math.max(0, etIdx + delta));
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
	const cellFills = $derived(showWater ? waterFills : null);
	const smRaster = $derived(showSm ? soil.frame : null);
	let etPanelHidden = $state(false);
	const etCellValue = $derived(etMonth ? (etSeries?.find((p) => p.month === etMonth) ?? null) : null);
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
		try {
			const res = await fetch('/fwa-api/hydro/et/latest', { cache: 'no-store' });
			const body = await res.json().catch(() => null);
			if (!res.ok) throw new Error(errorMessage(res.status, body));
			etRange = body;
			etIdx = monthRange(body.first, body.latest).length - 1;
		} catch (e) {
			etRangeError = e instanceof Error ? e.message : String(e);
		}
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
		etPanelHidden = false;
		smPanelHidden = false;
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

{#snippet sources(items: LayerSource[])}
	<p class="tlab-source">
		<span>Source</span>
		{#each items as s, i}
			{#if i}<span aria-hidden="true">·</span>{/if}
			{#if s.href}
				<a href={s.href} target="_blank" rel="noopener noreferrer">{s.label}</a>
			{:else}
				<span>{s.label}</span>
			{/if}
		{/each}
	</p>
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
					})}, totalled with the crop water budgets. Pick the year and season on the map; click a cell for its plots.
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
			{@render sources(SOURCES.water)}
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
			{@render sources(SOURCES.landscape)}
		</TLabSection>

		<TLabSection
			title="Evapotranspiration"
			subtitle="NRSC NHP · monthly actual ET, 750 m"
			swatch="linear-gradient(135deg, #ffffa0, #47de31, #203a77)"
			exclusive
			on={showEt}
			onToggle={(v) => setDataLayer('et', v)}
			bind:open={openSec.et}
		>
			{#if etRangeError}
				<p class="tlab-status tlab-error">Bhuvan ET service unavailable: {etRangeError}</p>
			{:else if !etRange || !etMonth}
				<p class="tlab-muted tlab-xs">Checking latest Bhuvan ET layer…</p>
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
					Energy-balance ET from SNPP-VIIRS, clipped to the district. White pixels are cloud.
				</p>
			{/if}
			{@render sources(SOURCES.et)}
		</TLabSection>

		<TLabSection
			title="Soil moisture"
			subtitle="Sentinel-1 radar · 250 m · every 6–12 days{soil.latest ? ` · to ${formatDay(soil.latest)}` : ''}"
			swatch="linear-gradient(135deg, {SM_PALETTE[1]}, {SM_PALETTE[4]}, {SM_PALETTE[7]})"
			exclusive
			on={showSm}
			onToggle={(v) => setDataLayer('sm', v)}
			bind:open={openSec.sm}
		>
			{#if soil.status === 'error'}
				<p class="tlab-status tlab-error">
					Soil moisture layer unavailable: {soil.error}
					<button type="button" class="tlab-link" onclick={() => soil.load()}>Try again</button>
				</p>
			{:else if soil.status !== 'done' || !soil.pass}
				<p class="tlab-muted tlab-xs">{showSm ? 'Loading Sentinel-1 soil moisture…' : 'Select this layer to load soil moisture.'}</p>
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
						<p class="tlab-muted tlab-xs">Click a cell for its soil moisture stats and history.</p>
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
								Open soil moisture stats and time series
							</button>
						{/if}
					{/if}
				</div>
				<p class="tlab-muted tlab-xs tlab-mt">
					Change detection on Sentinel-1 radar backscatter (VV), as in Copernicus's Sentinel-1 soil moisture
					products. It is relative to each spot's own range, not a volumetric reading; crop canopy and flooded
					paddies also change the signal.
				</p>
			{/if}
			{@render sources(SOURCES.sm)}
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
			{@render sources(SOURCES.boundaries)}
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
			{@render sources(SOURCES.canals)}
		</TLabSection>

		<TLabSection
			title="Grid"
			subtitle="S2 level-13 cells{grid ? ` · ${grid.features.length.toLocaleString('en-IN')}` : ''}"
			on={showGrid}
			onToggle={(v) => (showGrid = v)}
			bind:open={openSec.grid}
		>
			<p class="tlab-muted tlab-xs">Cell outlines. Cells stay clickable when the grid is hidden.</p>
			{@render sources(SOURCES.grid)}
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
			{etMonth}
			{showEt}
			{etOpacity}
			{cellFills}
			cellTooltip={waterTooltip}
			raster={smRaster}
			rasterLut={SM_LUT}
			rasterLabel={smLabel}
			rasterOpacity={smOpacity}
			{waterPlots}
			focusCover={!showWater && !showSm}
			waterPlotColors={water.plotColors}
			waterSelectedPlot={waterPlots ? water.selectedPlot : null}
			waterSelectedCrop={waterPlots && water.viewMode === 'group' ? water.selectedCrop : null}
			onWaterPlotSelect={selectWaterPlot}
			selectedFeatureId={selectedFeature?.id != null ? String(selectedFeature.id) : null}
			onCellSelect={selectCell}
			onFeatureSelect={(f) => (selectedFeature = f)}
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
			<TLabWaterControls {water} />
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
	{:else if showEt && selectedCellId && etRange && !etPanelHidden}
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
	{:else if showSm && selectedCellId && soil.status === 'done' && !smPanelHidden}
		<div class="tlab-panel-wrap">
			<svelte:boundary onerror={(e) => reportError(e instanceof Error ? (e.stack ?? e.message) : String(e))}>
				<TLabSmPanel {soil} cellId={selectedCellId} cellToken={selectedToken} onClose={() => (smPanelHidden = true)} />
				{#snippet failed()}
					<p class="tlab-status tlab-error">Could not show this cell's soil moisture.</p>
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

	.tlab-source {
		display: flex;
		flex-wrap: wrap;
		gap: 0.15rem 0.3rem;
		margin: 0.7rem 0 0;
		padding-top: 0.5rem;
		border-top: 1px dashed #00296b1a;
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
