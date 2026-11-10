<script lang="ts">
	import { onDestroy } from 'svelte';
	import TLabWorkspace from '$lib/components/TLabWorkspace.svelte';
	import ExplorerPreviewMap from '$lib/components/ExplorerPreviewMap.svelte';
	import { collectDroppedFiles } from '$lib/shapefileImport';
	import { readBoundaryFiles } from '$lib/regionBudget';
	import { waporExtentParam } from '$lib/tlab';
	import {
		ExplorerLoad,
		estimateLoadSeconds,
		fetchRegion,
		formatDuration,
		type ExplorerRegion
	} from '$lib/explorerRegion.svelte';

	type Stage = 'upload' | 'preview' | 'loading' | 'ready';

	let stage = $state<Stage>('upload');
	let region = $state.raw<ExplorerRegion | null>(null);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let dragging = $state(false);
	let input = $state<HTMLInputElement | null>(null);

	const load = new ExplorerLoad();
	onDestroy(() => load.cancel());

	const estimate = $derived(region ? estimateLoadSeconds(region) : 0);
	/** WaPOR extents are capped at 3° a side on the server */
	const waporTooBig = $derived(
		region ? region.bounds[2] - region.bounds[0] > 2.9 || region.bounds[3] - region.bounds[1] > 2.9 : false
	);
	const errors = $derived(load.coreTasks.filter((t) => t.status === 'error'));
	const canOpen = $derived(load.cells.length > 0);

	// Open the workspace as soon as the Google crops and budgets are in; WaPOR keeps downloading
	// and each WaPOR section shows its own progress.
	$effect(() => {
		if (stage === 'loading' && load.core === 'done' && region) stage = 'ready';
	});

	async function useFiles(files: File[]) {
		if (!files.length || busy) return;
		busy = true;
		error = null;
		try {
			const b = await readBoundaryFiles(files);
			region = await fetchRegion(b.name, b.featureCollection);
			stage = 'preview';
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
			if (input) input.value = '';
		}
	}

	async function onDrop(e: DragEvent) {
		e.preventDefault();
		dragging = false;
		if (e.dataTransfer) await useFiles(await collectDroppedFiles(e.dataTransfer));
	}

	async function queryLayers() {
		const r = region;
		if (!r) return;
		stage = 'loading';
		void load.run(r, waporExtentParam(r.bounds)!);
	}

	function cancelLoad() {
		load.cancel();
		stage = 'preview';
	}

	function startOver() {
		load.cancel();
		region = null;
		error = null;
		stage = 'upload';
	}

	function taskFraction(t: { done: number; total: number; status: string }): number {
		if (t.status === 'done') return 1;
		return t.total ? Math.min(1, t.done / t.total) : 0;
	}
</script>

<svelte:head>
	<title>Crop water estimation · Data Explorers</title>
</svelte:head>

{#snippet regionPanel()}
	{#if region}
		<div class="side-block">
			<div class="ex-label">Region</div>
			<strong class="side-name" title={region.name}>{region.name}</strong>
			<span class="side-meta">
				{region.areaKm2.toLocaleString('en-IN', { maximumFractionDigits: 1 })} km² ·
				{region.cells.toLocaleString('en-IN')} grid cells
				{#if load.failedCells}· {load.failedCells.toLocaleString('en-IN')} without Google data{/if}
			</span>
			<button type="button" class="ex-link" onclick={startOver}>New boundary</button>
		</div>
	{/if}
{/snippet}

{#if stage === 'ready' && region}
	<TLabWorkspace explorer {region} regionCells={load.cells} layerLoads={load.waporTasks} {regionPanel} />
{:else}
	<main class="ex">
		{#if stage === 'upload'}
			<section class="ex-card ex-upload">
				<h1>Crop water estimation</h1>
				<p class="ex-lead">Upload a boundary to start.</p>
				<div
					class="ex-drop"
					class:dragging
					role="button"
					tabindex="0"
					aria-label="Upload a boundary"
					ondragover={(e) => {
						e.preventDefault();
						dragging = true;
					}}
					ondragleave={() => (dragging = false)}
					ondrop={onDrop}
					onclick={() => input?.click()}
					onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && input?.click()}
				>
					{#if busy}
						<strong>Reading boundary…</strong>
					{:else}
						<strong>Drop a boundary here, or click to choose</strong>
						<span>Shapefile (.zip, or .shp with .dbf and .prj), GeoJSON or GeoPackage</span>
					{/if}
				</div>
				<input
					bind:this={input}
					type="file"
					multiple
					accept=".zip,.shp,.shx,.dbf,.prj,.cpg,.geojson,.json,.gpkg"
					hidden
					onchange={(e) => useFiles(Array.from(e.currentTarget.files ?? []))}
				/>
				{#if error}
					<p class="ex-error">{error}</p>
				{/if}
				<p class="ex-note">Up to about 15,000 km², and within 3° on a side for the WaPOR layers.</p>
			</section>
		{:else if region}
			<section class="ex-split">
				<div class="ex-map">
					<ExplorerPreviewMap boundary={region.boundary} />
				</div>
				<div class="ex-card ex-panel">
					<div class="ex-label">Boundary</div>
					<h2 title={region.name}>{region.name}</h2>
					<dl class="ex-facts">
						<div><dt>Area</dt><dd>{region.areaKm2.toLocaleString('en-IN', { maximumFractionDigits: 1 })} km²</dd></div>
						<div><dt>Grid cells</dt><dd>{region.cells.toLocaleString('en-IN')}</dd></div>
					</dl>

					{#if stage === 'preview'}
						<div class="ex-estimate">
							<span>Estimated time to open the map</span>
							<strong>{formatDuration(estimate)}</strong>
						</div>
						<ul class="ex-list">
							<li>Google ALU crops for every cell (water budget, field landscape)</li>
							<li>Crop water budgets</li>
							<li>
								FAO WaPOR evapotranspiration, rainfall, NPP, biomass and water productivity since 2018: these
								keep downloading after the map opens, newest first, with progress on each layer
							</li>
						</ul>
						{#if waporTooBig}
							<p class="ex-warn">This boundary is wider than 3°, so the WaPOR layers will not load for it.</p>
						{/if}
						<div class="ex-actions">
							<button type="button" class="ex-btn" onclick={queryLayers}>Query layers</button>
							<button type="button" class="ex-link" onclick={startOver}>Choose another boundary</button>
						</div>
					{:else}
						<div class="ex-overall">
							<div class="ex-overall-head">
								<span>
									{#if load.core === 'error'}Finished with errors{:else if load.core === 'done'}Done{:else}Loading crops…{/if}
								</span>
								<strong>{Math.round(load.progress * 100)}%</strong>
							</div>
							<div class="ex-bar"><span style:width="{load.progress * 100}%"></span></div>
							{#if load.core === 'loading'}
								<p class="ex-note">
									Estimated {formatDuration(estimate)}. The map opens when the crops are in; WaPOR layers fill in
									after that.
								</p>
							{/if}
						</div>
						<ul class="ex-tasks">
							{#each load.coreTasks as t (t.key)}
								<li class:done={t.status === 'done'} class:failed={t.status === 'error'}>
									<div class="ex-task-head">
										<span>{t.label}</span>
										<span class="ex-task-count">
											{#if t.status === 'done'}✓{:else if t.status === 'error'}Failed{:else if t.total && t.unit}{t.done.toLocaleString('en-IN')} / {t.total.toLocaleString('en-IN')} {t.unit}{:else}…{/if}
										</span>
									</div>
									<div class="ex-bar thin"><span style:width="{taskFraction(t) * 100}%"></span></div>
									{#if t.error}<p class="ex-task-error">{t.error}</p>{/if}
								</li>
							{/each}
						</ul>
						<div class="ex-actions">
							{#if load.core === 'loading'}
								<button type="button" class="ex-link" onclick={cancelLoad}>Cancel</button>
							{:else if load.core === 'error'}
								<button type="button" class="ex-btn" onclick={queryLayers}>Retry</button>
								{#if canOpen}
									<button type="button" class="ex-link" onclick={() => (stage = 'ready')}>
										Open without the {errors.length === 1 ? 'failed layer' : 'failed layers'}
									</button>
								{/if}
								<button type="button" class="ex-link" onclick={startOver}>Choose another boundary</button>
							{/if}
						</div>
					{/if}
				</div>
			</section>
		{/if}
	</main>
{/if}

<style>
	.ex {
		height: calc(100dvh - 3.6rem);
		background: #f8fafc;
		font-family: 'Montserrat', sans-serif;
		color: #00296b;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem;
		box-sizing: border-box;
		overflow: auto;
	}

	.ex-card {
		background: white;
		border: 1px solid color-mix(in srgb, #00296b 10%, white);
		border-radius: 0.8rem;
		box-shadow: 0 1px 3px rgb(0 41 107 / 6%);
	}

	.ex-upload {
		width: min(36rem, 100%);
		padding: 2rem;
		text-align: center;
	}

	h1 {
		margin: 0 0 0.5rem;
		font-family: 'Josefin Sans', sans-serif;
		font-size: 1.8rem;
	}

	h2 {
		margin: 0 0 0.8rem;
		font-family: 'Josefin Sans', sans-serif;
		font-size: 1.3rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.ex-lead {
		margin: 0 0 1.4rem;
		font-size: 0.9rem;
		line-height: 1.55;
		color: color-mix(in srgb, #00296b 70%, white);
	}

	.ex-drop {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		align-items: center;
		justify-content: center;
		min-height: 10rem;
		border: 2px dashed color-mix(in srgb, #1b75e0 45%, white);
		border-radius: 0.7rem;
		background: color-mix(in srgb, #1b75e0 4%, white);
		padding: 1.5rem;
		font-size: 0.95rem;
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s;
	}

	.ex-drop span {
		font-size: 0.78rem;
		color: color-mix(in srgb, #00296b 65%, white);
	}

	.ex-drop.dragging,
	.ex-drop:hover {
		border-color: #1b75e0;
		background: color-mix(in srgb, #1b75e0 10%, white);
	}

	.ex-split {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 24rem;
		gap: 1rem;
		width: 100%;
		height: 100%;
	}

	.ex-map {
		border-radius: 0.8rem;
		overflow: hidden;
		border: 1px solid color-mix(in srgb, #00296b 10%, white);
		min-height: 18rem;
	}

	.ex-panel {
		padding: 1.25rem;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	.ex-panel h2 {
		margin-bottom: 0;
	}

	@media (max-width: 860px) {
		.ex {
			align-items: stretch;
			height: auto;
			min-height: calc(100dvh - 3.6rem);
		}
		.ex-split {
			grid-template-columns: 1fr;
			grid-template-rows: 20rem auto;
		}
	}

	.ex-label {
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: color-mix(in srgb, #00296b 60%, white);
	}

	.ex-facts {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
		margin: 0;
	}

	.ex-facts div {
		background: #f8fafc;
		border-radius: 0.5rem;
		padding: 0.55rem 0.7rem;
	}

	.ex-facts dt {
		font-size: 0.68rem;
		color: color-mix(in srgb, #00296b 60%, white);
	}

	.ex-facts dd {
		margin: 0.15rem 0 0;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.ex-estimate {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		border-left: 3px solid #1b75e0;
		padding: 0.2rem 0 0.2rem 0.75rem;
		font-size: 0.78rem;
	}

	.ex-estimate strong {
		font-size: 1.15rem;
	}

	.ex-list {
		margin: 0;
		padding-left: 1.1rem;
		font-size: 0.78rem;
		line-height: 1.55;
		color: color-mix(in srgb, #00296b 75%, white);
	}

	.ex-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.8rem;
		margin-top: 0.2rem;
	}

	.ex-btn {
		border: 0;
		border-radius: 0.5rem;
		background: #00296b;
		color: white;
		font: inherit;
		font-size: 0.85rem;
		font-weight: 600;
		padding: 0.6rem 1.1rem;
		cursor: pointer;
	}

	.ex-btn:hover {
		background: #1b75e0;
	}

	.ex-link {
		border: 0;
		background: none;
		padding: 0;
		font: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		color: #1b75e0;
		cursor: pointer;
		text-align: left;
	}

	.ex-link:hover {
		text-decoration: underline;
	}

	.ex-overall-head {
		display: flex;
		justify-content: space-between;
		font-size: 0.85rem;
		margin-bottom: 0.4rem;
	}

	.ex-bar {
		height: 0.55rem;
		border-radius: 999px;
		background: color-mix(in srgb, #00296b 9%, white);
		overflow: hidden;
	}

	.ex-bar.thin {
		height: 0.3rem;
	}

	.ex-bar span {
		display: block;
		height: 100%;
		background: #1b75e0;
		transition: width 0.4s;
	}

	.ex-tasks {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
		font-size: 0.75rem;
	}

	.ex-task-head {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.25rem;
	}

	.ex-task-count {
		flex-shrink: 0;
		font-variant-numeric: tabular-nums;
		color: color-mix(in srgb, #00296b 60%, white);
	}

	.ex-tasks li.done .ex-bar span {
		background: #16a34a;
	}

	.ex-tasks li.done .ex-task-count {
		color: #16a34a;
		font-weight: 700;
	}

	.ex-tasks li.failed .ex-bar span {
		background: #dc2626;
	}

	.ex-tasks li.failed .ex-task-count,
	.ex-task-error,
	.ex-error {
		color: #b91c1c;
	}

	.ex-task-error {
		margin: 0.25rem 0 0;
		font-size: 0.7rem;
	}

	.ex-error {
		margin: 0.9rem 0 0;
		font-size: 0.82rem;
	}

	.ex-warn {
		margin: 0;
		font-size: 0.75rem;
		color: #b45309;
	}

	.ex-note {
		margin: 0.9rem 0 0;
		font-size: 0.72rem;
		line-height: 1.5;
		color: color-mix(in srgb, #00296b 55%, white);
	}

	.ex-overall .ex-note {
		margin-top: 0.4rem;
	}

	.side-block {
		background: white;
		border: 1px solid color-mix(in srgb, #00296b 10%, white);
		border-radius: 0.6rem;
		padding: 0.85rem;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-family: 'Montserrat', sans-serif;
		color: #00296b;
		font-size: 0.8rem;
	}

	.side-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.side-meta {
		font-size: 0.72rem;
		color: color-mix(in srgb, #00296b 65%, white);
	}

	.side-block .ex-link {
		margin-top: 0.3rem;
	}
</style>
