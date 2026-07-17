<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import {
		BUILTIN_BASEMAPS,
		CATEGORY_LABELS,
		CATEGORY_ORDER,
		type AnyBasemap,
		type BuiltinBasemap,
		type OfflineBasemap
	} from '$lib/formCreator/basemaps';

	interface Props {
		selectedIds: string[];
		offlineBasemaps: OfflineBasemap[];
		boundaries: GeoJSON.FeatureCollection;
		onSelectionChange: (ids: string[]) => void;
		onOfflineChange: (files: OfflineBasemap[]) => void;
	}

	let {
		selectedIds,
		offlineBasemaps,
		boundaries,
		onSelectionChange,
		onOfflineChange
	}: Props = $props();

	// Which basemap is being previewed on the right map (default: first builtin)
	let previewingId = $state<string>(BUILTIN_BASEMAPS[0].id);

	// ─── Map state ───────────────────────────────────────────────────────────────
	let mapContainer: HTMLDivElement;
	let map: import('leaflet').Map | null = null;
	let L: typeof import('leaflet') | null = null;
	let currentBasemapLayer: import('leaflet').Layer | null = null;
	let boundaryLayer: import('leaflet').GeoJSON | null = null;
	// Keep sql.js DB instances for MBTiles so we don't re-parse on every preview
	const mbtilesCache = new Map<string, import('sql.js').Database>();

	// ─── Offline upload ───────────────────────────────────────────────────────
	let dropActive = $state(false);

	// ─── Derived: grouped builtins ────────────────────────────────────────────
	const grouped = $derived(
		CATEGORY_ORDER.map((cat) => ({
			cat,
			label: CATEGORY_LABELS[cat],
			items: BUILTIN_BASEMAPS.filter((b) => b.category === cat)
		})).filter((g) => g.items.length > 0)
	);

	const allSelected = $derived(
		[...BUILTIN_BASEMAPS.map((b) => b.id), ...offlineBasemaps.map((b) => b.id)].filter((id) =>
			selectedIds.includes(id)
		)
	);

	// Derived values for the preview overlays (avoids invalid {@const} placement)
	const currentPreviewBm = $derived(
		[...(BUILTIN_BASEMAPS as import('$lib/formCreator/basemaps').AnyBasemap[]), ...offlineBasemaps].find(
			(b) => b.id === previewingId
		) ?? null
	);
	const previewOffline = $derived(offlineBasemaps.find((b) => b.id === previewingId) ?? null);
	const previewBuiltin = $derived(BUILTIN_BASEMAPS.find((b) => b.id === previewingId) ?? null);

	// ─── Map helpers ──────────────────────────────────────────────────────────

	function renderBoundaries() {
		if (!map || !L) return;
		if (boundaryLayer) {
			boundaryLayer.remove();
			boundaryLayer = null;
		}
		if (boundaries.features.length === 0) return;
		boundaryLayer = L.geoJSON(boundaries, {
			style: { color: '#2563eb', weight: 2, fillColor: '#60a5fa', fillOpacity: 0.35 }
		}).addTo(map);
	}

	async function setPreviewLayer(bm: AnyBasemap) {
		if (!map || !L) return;

		// Remove existing basemap layer
		if (currentBasemapLayer) {
			currentBasemapLayer.remove();
			currentBasemapLayer = null;
		}

		if (!bm.requiresInternet) {
			// Offline basemap
			if (bm.type === 'mbtiles') {
				const result = await buildMBTilesLayer(bm);
				if (result && map) {
					currentBasemapLayer = result.layer;
					result.layer.addTo(map);
					// Fit map to the file's bounding box so tiles are visible
					if (result.bounds) {
						map.fitBounds(result.bounds, { padding: [16, 16] });
					}
				} else if (map) {
					// Fallback to OSM if MBTiles couldn't be loaded
					currentBasemapLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
						attribution: '© OpenStreetMap contributors',
						maxZoom: 19,
						opacity: 0.5
					}).addTo(map);
				}
				// Ensure boundaries stay on top
				boundaryLayer?.remove();
				boundaryLayer && boundaryLayer.addTo(map);
			} else {
				// GeoTIFF — no browser preview, show OSM placeholder
				currentBasemapLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
					attribution: '© OpenStreetMap contributors',
					maxZoom: 19,
					opacity: 0.6
				}).addTo(map);
				boundaryLayer?.remove();
				boundaryLayer && boundaryLayer.addTo(map);
			}
		} else {
			// Online builtin
			const b = bm as BuiltinBasemap;
			currentBasemapLayer = L.tileLayer(b.leafletUrl, {
				attribution: b.attribution,
				maxZoom: b.maxZoom
			}).addTo(map);
			// Keep boundaries on top
			boundaryLayer?.remove();
			boundaryLayer && boundaryLayer.addTo(map);
		}
	}

	interface MBTilesResult {
		layer: import('leaflet').GridLayer;
		bounds: [[number, number], [number, number]] | null;
		minZoom: number;
	}

	async function buildMBTilesLayer(bm: OfflineBasemap): Promise<MBTilesResult | null> {
		if (!L) return null;
		try {
			let db = mbtilesCache.get(bm.id);
			if (!db) {
				// sql.js is pre-bundled by Vite (include in optimizeDeps) so it loads as ESM.
				// Vite uses the browser export (sql-wasm-browser.js) which needs
				// sql-wasm-browser.wasm — we copied that to /static/sql-wasm-browser-v114.wasm.
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const sqlMod = await import('sql.js') as any;
				// Handle both `export default fn` and `module.exports = fn` interop forms
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const initSqlJs: (cfg: object) => Promise<any> =
					typeof sqlMod.default === 'function' ? sqlMod.default : sqlMod;
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const SQL: any = await initSqlJs({
					locateFile: () => '/sql-wasm-browser-v114.wasm'
				});
				const buf = await bm.file.arrayBuffer();
				db = new SQL.Database(new Uint8Array(buf)) as import('sql.js').Database;
				mbtilesCache.set(bm.id, db);
			}
			const capturedDb = db;

			// Read bounds + minzoom from metadata so we can fit the map to the file's coverage
			let bounds: [[number, number], [number, number]] | null = null;
			let minZoom = 0;
			try {
				const metaRows = capturedDb.exec('SELECT name, value FROM metadata');
				if (metaRows.length > 0) {
					for (const row of metaRows[0].values) {
						const name = String(row[0] ?? '');
						const value = String(row[1] ?? '');
						if (name === 'bounds' && value) {
							const parts = value.split(',').map(Number);
							if (parts.length === 4) {
								const [west, south, east, north] = parts;
								bounds = [[south, west], [north, east]];
							}
						}
						if (name === 'minzoom' && value) minZoom = parseInt(value, 10) || 0;
					}
				}
			} catch { /* metadata read failed — skip bounds fitting */ }

			// Custom GridLayer that serves tiles from the SQLite MBTiles DB.
			// MBTiles uses TMS y-axis (y=0 at south); Leaflet XYZ has y=0 at north — flip it.
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const LayerClass = (L.GridLayer as any).extend({
				createTile(
					coords: import('leaflet').Coords,
					done: import('leaflet').DoneCallback
				): HTMLElement {
					const img = document.createElement('img');
					img.style.width = '256px';
					img.style.height = '256px';
					const { x, y, z } = coords;
					const tmsY = (1 << z) - 1 - y; // TMS ↔ XYZ y-flip
					try {
						const result = capturedDb.exec(
							'SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?',
							[z, x, tmsY]
						);
						if (result.length > 0 && result[0].values.length > 0) {
							const raw = result[0].values[0][0] as Uint8Array;
							const data = raw.buffer.slice(
								raw.byteOffset,
								raw.byteOffset + raw.byteLength
							) as ArrayBuffer;
							const blob = new Blob([data]);
							const url = URL.createObjectURL(blob);
							img.onload = () => { URL.revokeObjectURL(url); done(undefined, img); };
							img.onerror = () => done(undefined, img);
							img.src = url;
						} else {
							done(undefined, img);
						}
					} catch (err) {
						console.warn('MBTiles tile read error:', err);
						done(undefined, img);
					}
					return img;
				}
			});
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const layer = new LayerClass({ minZoom, maxZoom: 22, tileSize: 256 }) as import('leaflet').GridLayer;
			return { layer, bounds, minZoom };
		} catch (err) {
			console.error('Failed to open MBTiles file:', err);
			return null;
		}
	}

	// ─── Interaction ──────────────────────────────────────────────────────────

	function toggleSelection(id: string) {
		if (selectedIds.includes(id)) {
			onSelectionChange(selectedIds.filter((i) => i !== id));
		} else {
			onSelectionChange([...selectedIds, id]);
		}
	}

	async function previewBasemap(bm: AnyBasemap) {
		previewingId = bm.id;
		await setPreviewLayer(bm);
	}

	// ─── Offline file upload ──────────────────────────────────────────────────

	function handleOfflineDrop(e: DragEvent) {
		e.preventDefault();
		dropActive = false;
		const files = Array.from(e.dataTransfer?.files ?? []);
		addOfflineFiles(files);
	}

	function handleOfflineInput(e: Event) {
		const files = Array.from((e.target as HTMLInputElement).files ?? []);
		addOfflineFiles(files);
		(e.target as HTMLInputElement).value = '';
	}

	function addOfflineFiles(files: File[]) {
		const accepted = files.filter((f) =>
			/\.(mbtiles|tif|tiff|geotiff)$/i.test(f.name)
		);
		if (accepted.length === 0) return;
		const newEntries: OfflineBasemap[] = accepted.map((file) => ({
			id: `offline-${crypto.randomUUID()}`,
			label: file.name,
			type: /\.mbtiles$/i.test(file.name) ? 'mbtiles' : 'geotiff',
			file,
			requiresInternet: false
		}));
		const updated = [...offlineBasemaps, ...newEntries];
		onOfflineChange(updated);
		// Auto-select newly added files and preview the first one
		onSelectionChange([...selectedIds, ...newEntries.map((e) => e.id)]);
		previewBasemap(newEntries[0]);
	}

	function removeOfflineFile(id: string) {
		onOfflineChange(offlineBasemaps.filter((b) => b.id !== id));
		onSelectionChange(selectedIds.filter((i) => i !== id));
		mbtilesCache.delete(id);
		if (previewingId === id) {
			const first = BUILTIN_BASEMAPS[0];
			previewingId = first.id;
			setPreviewLayer(first);
		}
	}

	// ─── Lifecycle ────────────────────────────────────────────────────────────

	onMount(async () => {
		const leaflet = await import('leaflet');
		L = leaflet;

		map = leaflet.map(mapContainer, { zoomControl: true }).setView([20, 78], 5);

		// Find & load the initial preview basemap
		const initialBuiltin = BUILTIN_BASEMAPS.find((b) => b.id === previewingId);
		if (initialBuiltin) {
			currentBasemapLayer = leaflet
				.tileLayer(initialBuiltin.leafletUrl, {
					attribution: initialBuiltin.attribution,
					maxZoom: initialBuiltin.maxZoom
				})
				.addTo(map);
		}

		renderBoundaries();

		// If boundaries exist, fit to them
		if (boundaries.features.length > 0 && boundaryLayer) {
			const bounds = boundaryLayer.getBounds();
			if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24] });
		}
	});

	onDestroy(() => {
		for (const db of mbtilesCache.values()) db.close();
		mbtilesCache.clear();
		map?.remove();
	});

	// Category colour pill classes
	const catPill: Record<string, string> = {
		streets: 'bg-slate-100 text-slate-600',
		humanitarian: 'bg-orange-100 text-orange-700',
		topo: 'bg-green-100 text-green-700',
		satellite: 'bg-sky-100 text-sky-700'
	};
</script>

<div class="flex overflow-hidden rounded-xl border border-slate-200 bg-white" style="height: calc(100vh - 290px); min-height: 500px;">
	<!-- ── LEFT: basemap list ──────────────────────────────────────────────────── -->
	<div class="flex w-72 shrink-0 flex-col border-r border-slate-200">
		<div class="border-b border-slate-100 px-4 py-3">
			<p class="text-sm font-semibold text-slate-700">Select basemaps</p>
			<p class="mt-0.5 text-xs text-slate-400">
				Tick to include · click row to preview →
			</p>
		</div>

		<!-- Scrollable layer list -->
		<div class="flex-1 overflow-y-auto py-2">
			{#each grouped as group}
				<p class="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
					{group.label}
				</p>
				{#each group.items as bm}
					{@const isPreviewing = previewingId === bm.id}
					{@const isSelected = selectedIds.includes(bm.id)}
					<div
						class="group flex cursor-pointer items-center gap-2 px-3 py-2 transition-colors
						{isPreviewing ? 'bg-blue-50' : 'hover:bg-slate-50'}"
						role="button"
						tabindex="0"
						aria-label="Preview {bm.label}"
						onclick={() => previewBasemap(bm)}
						onkeydown={(e) => e.key === 'Enter' && previewBasemap(bm)}
					>
						<!-- Checkbox: click stops propagation so it only toggles, doesn't preview -->
						<div
							class="flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors
							{isSelected ? 'border-blue-500 bg-blue-500' : 'border-slate-300 bg-white group-hover:border-slate-400'}"
							role="checkbox"
							tabindex="0"
							aria-checked={isSelected}
							aria-label="Include {bm.label}"
							onclick={(e) => { e.stopPropagation(); toggleSelection(bm.id); }}
							onkeydown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.stopPropagation(); toggleSelection(bm.id); } }}
						>
							{#if isSelected}
								<svg class="h-3 w-3 text-white" viewBox="0 0 12 12" fill="currentColor">
									<path d="M10 3L5 8.5 2 5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
								</svg>
							{/if}
						</div>

						<!-- Name + badge -->
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm font-medium leading-tight
							{isPreviewing ? 'text-blue-700' : 'text-slate-700'}">
								{bm.label}
							</p>
						</div>

						<!-- Internet badge -->
						<span class="shrink-0 text-slate-300" title="Requires internet">
							<svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
								<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm-3.536-9.536A5.5 5.5 0 0110 6.5c1.07 0 2.07.305 2.913.832l-1.12 1.12A3.5 3.5 0 006.5 10c0 .636.17 1.23.467 1.74l-1.12 1.12A5.474 5.474 0 016.5 10c0-.558.08-1.097.226-1.608l-.262-.262zM10 13.5a3.5 3.5 0 003.5-3.5c0-.636-.17-1.23-.467-1.74l1.12-1.12A5.474 5.474 0 0113.5 10a5.5 5.5 0 11-5.5-5.5z" clip-rule="evenodd"/>
							</svg>
						</span>

						<!-- Preview indicator -->
						{#if isPreviewing}
							<span class="shrink-0">
								<svg class="h-3.5 w-3.5 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
									<path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/>
									<path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/>
								</svg>
							</span>
						{/if}
					</div>
				{/each}
			{/each}

			<!-- Offline basemaps (uploaded) -->
			{#if offlineBasemaps.length > 0}
				<p class="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
					Offline files
				</p>
				{#each offlineBasemaps as bm}
					{@const isPreviewing = previewingId === bm.id}
					{@const isSelected = selectedIds.includes(bm.id)}
					<div
						class="group flex cursor-pointer items-center gap-2 px-3 py-2 transition-colors
						{isPreviewing ? 'bg-blue-50' : 'hover:bg-slate-50'}"
						role="button"
						tabindex="0"
						aria-label="Preview {bm.label}"
						onclick={() => previewBasemap(bm)}
						onkeydown={(e) => e.key === 'Enter' && previewBasemap(bm)}
					>
						<div
							class="flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors
							{isSelected ? 'border-blue-500 bg-blue-500' : 'border-slate-300 bg-white group-hover:border-slate-400'}"
							role="checkbox"
							tabindex="0"
							aria-checked={isSelected}
							aria-label="Include {bm.label}"
							onclick={(e) => { e.stopPropagation(); toggleSelection(bm.id); }}
							onkeydown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.stopPropagation(); toggleSelection(bm.id); } }}
						>
							{#if isSelected}
								<svg class="h-3 w-3 text-white" viewBox="0 0 12 12" fill="currentColor">
									<path d="M10 3L5 8.5 2 5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
								</svg>
							{/if}
						</div>

						<div class="min-w-0 flex-1">
							<p class="truncate text-xs font-medium leading-tight
							{isPreviewing ? 'text-blue-700' : 'text-slate-700'}">
								{bm.label}
							</p>
							<p class="text-[10px] text-emerald-600">
								{bm.type === 'mbtiles' ? 'MBTiles · offline' : 'GeoTIFF · offline'}
							</p>
						</div>

						{#if isPreviewing}
							<svg class="h-3.5 w-3.5 shrink-0 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
								<path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/>
								<path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/>
							</svg>
						{/if}

						<!-- Remove button -->
						<button
							type="button"
							class="ml-1 shrink-0 rounded p-0.5 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-500"
							aria-label="Remove {bm.label}"
							onclick={(e) => { e.stopPropagation(); removeOfflineFile(bm.id); }}
						>
							<svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
								<path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
							</svg>
						</button>
					</div>
				{/each}
			{/if}
		</div>

		<!-- Offline upload zone (pinned at bottom of left panel) -->
		<div class="border-t border-slate-200 p-3">
			<div
				class="flex flex-col items-center justify-center rounded-lg border-2 border-dashed py-4 text-center transition-colors
				{dropActive ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-slate-50'}"
				role="button"
				tabindex="0"
				aria-label="Upload offline basemap"
				ondragover={(e) => { e.preventDefault(); dropActive = true; }}
				ondragleave={() => (dropActive = false)}
				ondrop={handleOfflineDrop}
				onclick={() => {
					const el = document.querySelector<HTMLInputElement>('#offline-file-input');
					el?.click();
				}}
				onkeydown={(e) => { if (e.key === 'Enter') { const el = document.querySelector<HTMLInputElement>('#offline-file-input'); el?.click(); } }}
			>
				<svg class="mb-1.5 h-6 w-6 {dropActive ? 'text-blue-400' : 'text-slate-300'}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
				</svg>
				<p class="text-xs font-semibold {dropActive ? 'text-blue-700' : 'text-slate-500'}">
					Drop MBTiles / GeoTIFF
				</p>
				<p class="mt-0.5 text-[10px] text-slate-400">or click to browse · works offline</p>
			</div>
			<input
				id="offline-file-input"
				type="file"
				accept=".mbtiles,.tif,.tiff,.geotiff"
				multiple
				class="hidden"
				onchange={handleOfflineInput}
			/>
		</div>
	</div>

	<!-- ── RIGHT: Leaflet preview map ─────────────────────────────────────────── -->
	<div class="relative flex-1">
		<div bind:this={mapContainer} class="h-full w-full"></div>

		<!-- Preview label overlay -->
		{#if currentPreviewBm}
			<div class="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-white/30 bg-black/50 px-3 py-1 text-xs font-medium text-white shadow backdrop-blur-sm">
				{currentPreviewBm.label}
				{#if !currentPreviewBm.requiresInternet}
					<span class="ml-1.5 rounded bg-emerald-500/80 px-1.5 py-0.5 text-[10px] font-semibold">offline</span>
				{:else}
					<span class="ml-1.5 rounded bg-white/20 px-1.5 py-0.5 text-[10px]">🌐 internet</span>
				{/if}
			</div>
		{/if}

		<!-- GeoTIFF no-preview notice -->
		{#if previewOffline?.type === 'geotiff'}
			<div class="pointer-events-none absolute left-3 top-3 max-w-xs rounded-lg border border-amber-200 bg-amber-50/90 px-3 py-2 text-xs text-amber-800 shadow backdrop-blur-sm">
				<strong>GeoTIFF loaded.</strong> Browser preview uses OSM — GeoTIFF renders correctly in QGIS &amp; QField.
			</div>
		{:else if previewOffline?.type === 'mbtiles'}
			<div class="pointer-events-none absolute left-3 top-3 max-w-xs rounded-lg border border-sky-200 bg-sky-50/90 px-3 py-2 text-xs text-sky-800 shadow backdrop-blur-sm">
				<strong>MBTiles preview.</strong> Rendering tiles from your file. If tiles appear blank, your file may not cover this zoom level.
			</div>
		{:else if previewBuiltin}
			<!-- Internet required notice for online layers -->
			<div class="pointer-events-none absolute left-3 top-3 rounded-lg border border-slate-200 bg-white/90 px-3 py-2 text-[11px] text-slate-600 shadow backdrop-blur-sm">
				🌐 Requires internet on QField device
			</div>
		{/if}
	</div>
</div>

<!-- Selection summary -->
<div class="mt-3 flex items-center gap-2 text-sm text-slate-500">
	{#if allSelected.length === 0}
		<svg class="h-4 w-4 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
			<path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
		</svg>
		<span>No basemaps selected — tick at least one to include in the QGZ.</span>
	{:else}
		<svg class="h-4 w-4 text-emerald-500" viewBox="0 0 20 20" fill="currentColor">
			<path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
		</svg>
		<span>
			{allSelected.length} basemap{allSelected.length === 1 ? '' : 's'} selected
			{#if offlineBasemaps.some(b => selectedIds.includes(b.id))}
				<span class="ml-1 text-emerald-600">· includes offline layers</span>
			{/if}
		</span>
	{/if}
</div>
