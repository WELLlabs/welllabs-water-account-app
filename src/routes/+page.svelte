<script lang="ts">
	import { onMount } from 'svelte';
	import { parseGpkgFile } from '$lib/gpkgParser';
	import { configureGeoPackage } from '$lib/setupGeopackage';
	import FarmMap from '$lib/components/FarmMap.svelte';

	onMount(() => {
		configureGeoPackage();
	});

	let selectedFeature = $state<GeoJSON.Feature | null>(null);
	let geojson = $state<GeoJSON.FeatureCollection | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let fileName = $state<string | null>(null);
	let featureCount = $state(0);

	async function handleFileUpload(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		loading = true;
		error = null;
		selectedFeature = null;
		fileName = file.name;

		try {
			const budgetResponse = await fetch('/farm_water_budget.csv');
			if (!budgetResponse.ok) {
				throw new Error('Could not load farm_water_budget.csv');
			}
			const budgetCsv = await budgetResponse.text();

			const buffer = await file.arrayBuffer();
			const processed = await parseGpkgFile(buffer, budgetCsv);

			geojson = processed;
			featureCount = processed.features.length;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to process GeoPackage file.';
			geojson = null;
			featureCount = 0;
		} finally {
			loading = false;
		}
	}
</script>

<main>
	<header>
		<div>
			<h1>Farm Water Accounting</h1>
			<p>Upload a GeoPackage to visualize farm plots and monthly water requirements by crop.</p>
		</div>

		<label class="upload-btn">
			<input type="file" accept=".gpkg,.GPKG" onchange={handleFileUpload} disabled={loading} />
			{loading ? 'Processing…' : 'Upload GPKG'}
		</label>
	</header>

	{#if error}
		<div class="error-banner">{error}</div>
	{/if}

	{#if fileName && !error}
		<div class="file-info">
			<span><strong>File:</strong> {fileName}</span>
			<span><strong>Plots:</strong> {featureCount}</span>
		</div>
	{/if}

	{#if geojson}
		<FarmMap
			{geojson}
			{selectedFeature}
			onFeatureSelect={(feature) => {
				selectedFeature = feature;
			}}
		/>
	{:else if !loading}
		<section class="placeholder">
			<div class="placeholder-card">
				<h2>Get started</h2>
				<p>Upload a <code>.gpkg</code> file containing <code>CROP_26_K</code> and <code>Sowing_Date</code> columns.</p>
				<p>
					Water requirements are calculated from
					<code>farm_water_budget.csv</code>, starting from each plot's sowing date through the
					crop season end.
				</p>
			</div>
		</section>
	{/if}
</main>

<style>
	:global(body) {
		margin: 0;
		font-family:
			'Segoe UI',
			system-ui,
			-apple-system,
			sans-serif;
		background: #f1f5f9;
		color: #0f172a;
	}

	main {
		max-width: 1400px;
		margin: 0 auto;
		padding: 1.5rem;
	}

	header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	h1 {
		margin: 0 0 0.35rem;
		font-size: 1.75rem;
	}

	header p {
		margin: 0;
		color: #64748b;
	}

	.upload-btn {
		display: inline-flex;
		align-items: center;
		padding: 0.65rem 1.1rem;
		border-radius: 8px;
		background: #2563eb;
		color: #fff;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
		transition: background 0.15s;
	}

	.upload-btn:hover {
		background: #1d4ed8;
	}

	.upload-btn input {
		display: none;
	}

	.error-banner {
		margin-bottom: 1rem;
		padding: 0.75rem 1rem;
		border-radius: 8px;
		background: #fee2e2;
		color: #991b1b;
	}

	.file-info {
		display: flex;
		gap: 1.5rem;
		margin-bottom: 1rem;
		font-size: 0.9rem;
		color: #475569;
	}

	.placeholder {
		display: flex;
		justify-content: center;
		padding: 3rem 1rem;
	}

	.placeholder-card {
		max-width: 520px;
		padding: 2rem;
		border-radius: 12px;
		background: #fff;
		border: 1px dashed #cbd5e1;
		text-align: center;
	}

	.placeholder-card h2 {
		margin-top: 0;
	}

	.placeholder-card p {
		color: #64748b;
		line-height: 1.6;
	}

	code {
		padding: 0.1rem 0.35rem;
		border-radius: 4px;
		background: #e2e8f0;
		font-size: 0.85em;
	}

	@media (max-width: 700px) {
		header {
			flex-direction: column;
		}
	}
</style>
