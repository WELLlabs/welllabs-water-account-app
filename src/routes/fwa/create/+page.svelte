<script lang="ts">
	import { onMount } from 'svelte';
	import FormCreatorMap from '$lib/components/FormCreatorMap.svelte';
	import BasemapStep from '$lib/components/BasemapStep.svelte';
	import ColumnStep from '$lib/components/ColumnStep.svelte';
	import {
		createDefaultFields,
		DEFAULT_FIC_MAPPINGS,
		CUSTOM_FIELD_TYPES,
		createFieldId
	} from '$lib/formCreator/defaults';
	import { exportQgzProject, downloadQgz } from '$lib/formCreator/qgzExporter';
	import { readGpkgBoundaries } from '$lib/formCreator/boundaryImport';
	import { configureGeoPackage } from '$lib/setupGeopackage';
	import type { ColumnConfig, FicMapping, FormField, FormFieldType } from '$lib/formCreator/types';
	import { BUILTIN_BASEMAPS, type OfflineBasemap } from '$lib/formCreator/basemaps';
	import { extractColumns } from '$lib/formCreator/columnUtils';
	import { pushToQFieldCloud, QFieldCloudError } from '$lib/formCreator/qfieldCloud';

	// ─── Step metadata ───────────────────────────────────────────────────────────

	const STEP_LABELS = [
		'Boundaries',
		'Columns',
		'Basemap',
		'Select fields',
		'Edit fields',
		'Custom fields',
		'Export'
	];

	const FIELD_DESCRIPTIONS: Record<string, string> = {
		farmer_name: 'Text — name of the farmer',
		farmer_ph_no: 'Text — mobile number',
		crop: 'Text — crop being grown',
		sowing_date: 'Date picker — when the crop was sown',
		irrigation_status: 'Dropdown — Canal / Lift / Not irrigated',
		lateral: 'Dropdown — L1 through L6',
		fic: 'Dynamic dropdown — FIC options filtered by the selected Lateral',
		conjunctives: 'Dropdown — Rain / Canal / Groundwater'
	};

	// ─── State ───────────────────────────────────────────────────────────────────

	let step = $state<1 | 2 | 3 | 4 | 5 | 6 | 7>(1);
	let highestStep = $state(1);

	// Step 1 — Boundaries
	let boundaries = $state<GeoJSON.FeatureCollection>({ type: 'FeatureCollection', features: [] });
	let boundaryVersion = $state(0);
	let dragActive = $state(false);
	let loadingBoundaries = $state(false);

	// Step 2 — Columns
	let columns = $state<ColumnConfig[]>([]);

	// Step 3 — Basemaps (OSM selected by default)
	let selectedBasemapIds = $state<string[]>(['osm']);
	let offlineBasemaps = $state<OfflineBasemap[]>([]);

	// Step 4 — Default field selection
	const initialDefaults = createDefaultFields();
	let allDefaultFields = $state<FormField[]>(initialDefaults);
	let selectedDefaultIds = $state<Set<string>>(new Set(initialDefaults.map((f) => f.id)));

	// Step 5 — FIC mapping
	let ficMappings = $state<FicMapping[]>(
		DEFAULT_FIC_MAPPINGS.map((m) => ({ ...m, fics: [...m.fics] }))
	);

	// Step 6 — Custom fields
	let customFields = $state<FormField[]>([]);

	// Step 7 — Project settings
	let projectName = $state('Farm Survey');
	let tableName = $state('farm_plots');

	// Step 7 — Export
	let exporting = $state(false);
	let error = $state<string | null>(null);

	// Step 7 — QField Cloud push
	let qfcToken = $state('');
	let qfcProjectName = $state('');
	let qfcPushing = $state(false);
	let qfcProgress = $state(0);
	let qfcStatus = $state('');
	let qfcError = $state<string | null>(null);
	let qfcSuccess = $state<{ projectId: string; projectUrl: string } | null>(null);

	// ─── Derived ─────────────────────────────────────────────────────────────────

	const lateralId = $derived(allDefaultFields.find((f) => f.name === 'lateral')?.id ?? '');
	const ficId = $derived(allDefaultFields.find((f) => f.name === 'fic')?.id ?? '');
	const showFicMapping = $derived(
		selectedDefaultIds.has(lateralId) && selectedDefaultIds.has(ficId)
	);
	const hasFicWithoutLateral = $derived(
		selectedDefaultIds.has(ficId) && !selectedDefaultIds.has(lateralId)
	);
	const selectedDefaults = $derived(allDefaultFields.filter((f) => selectedDefaultIds.has(f.id)));
	const exportFields = $derived([...selectedDefaults, ...customFields]);
	const keptColumns = $derived(columns.filter((c) => c.keep));
	const allBasemaps = $derived([
		// Offline first → higher in QGIS layer tree (drawn above online basemaps)
		...offlineBasemaps.filter((b) => selectedBasemapIds.includes(b.id)),
		...BUILTIN_BASEMAPS.filter((b) => selectedBasemapIds.includes(b.id))
	]);
	const hasMultiselect = $derived(exportFields.some((f) => f.type === 'multiselect'));

	// ─── Setup ───────────────────────────────────────────────────────────────────

	onMount(() => configureGeoPackage());

	// Sync QField Cloud project name with project name
	$effect(() => {
		if (!qfcProjectName) qfcProjectName = projectName;
	});

	// ─── Navigation ──────────────────────────────────────────────────────────────

	function goToStep(s: 1 | 2 | 3 | 4 | 5 | 6 | 7) {
		if (s <= highestStep) {
			step = s;
			error = null;
		}
	}

	function advance() {
		// Step 1 → 2: require boundaries
		if (step === 1 && boundaries.features.length === 0) {
			error = 'Please import a boundary file before continuing.';
			return;
		}
		// Step 2 → 3: require ID and area columns assigned
		if (step === 2) {
			const hasId = columns.some((c) => c.role === 'id');
			const hasArea = columns.some((c) => c.role === 'area');
			if (!hasId) { error = 'Please assign or generate a Plot ID column.'; return; }
			if (!hasArea) { error = 'Please assign or generate an Area column.'; return; }
		}
		const next = Math.min(step + 1, 7) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
		step = next;
		if (next > highestStep) highestStep = next;
		error = null;
	}

	function back() {
		if (step > 1) step = (step - 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
		error = null;
	}

	// ─── Step 1: boundaries ──────────────────────────────────────────────────────

	async function loadBoundaryFile(file: File) {
		loadingBoundaries = true;
		error = null;
		try {
			let fc: GeoJSON.FeatureCollection;
			if (file.name.toLowerCase().endsWith('.gpkg')) {
				fc = await readGpkgBoundaries(await file.arrayBuffer());
			} else {
				const text = await file.text();
				const parsed = JSON.parse(text) as GeoJSON.FeatureCollection;
				if (parsed.type !== 'FeatureCollection' || !Array.isArray(parsed.features)) {
					throw new Error('Not a FeatureCollection');
				}
				fc = parsed;
			}
			boundaries = fc;
			boundaryVersion += 1;
			// Initialise column management from newly loaded features
			columns = extractColumns(fc);
		} catch {
			error = 'Could not read file. Please drop a .gpkg or .geojson file.';
		} finally {
			loadingBoundaries = false;
		}
	}

	function handleDragOver(e: DragEvent) { e.preventDefault(); dragActive = true; }
	function handleDragLeave(e: DragEvent) { e.preventDefault(); dragActive = false; }

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		dragActive = false;
		const file = e.dataTransfer?.files?.[0];
		if (file) loadBoundaryFile(file);
	}

	function handleFileInput(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (file) loadBoundaryFile(file);
		(e.target as HTMLInputElement).value = '';
	}

	function clearBoundaries() {
		boundaries = { type: 'FeatureCollection', features: [] };
		boundaryVersion += 1;
		columns = [];
	}

	// ─── Step 4: select / deselect defaults ──────────────────────────────────────

	function toggleDefault(id: string) {
		const next = new Set(selectedDefaultIds);
		if (next.has(id)) next.delete(id); else next.add(id);
		selectedDefaultIds = next;
	}
	function selectAll() { selectedDefaultIds = new Set(allDefaultFields.map((f) => f.id)); }
	function deselectAll() { selectedDefaultIds = new Set(); }

	// ─── Step 5: edit defaults ────────────────────────────────────────────────────

	function updateDefaultField(fieldId: string, patch: Partial<FormField>) {
		allDefaultFields = allDefaultFields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f));
	}
	function addDefaultOption(fieldId: string) {
		const field = allDefaultFields.find((f) => f.id === fieldId);
		if (!field) return;
		updateDefaultField(fieldId, { options: [...(field.options ?? []), { value: '', label: '' }] });
	}
	function updateDefaultOption(fieldId: string, optIdx: number, key: 'value' | 'label', val: string) {
		const field = allDefaultFields.find((f) => f.id === fieldId);
		if (!field) return;
		updateDefaultField(fieldId, {
			options: (field.options ?? []).map((o, i) => (i === optIdx ? { ...o, [key]: val } : o))
		});
	}
	function removeDefaultOption(fieldId: string, optIdx: number) {
		const field = allDefaultFields.find((f) => f.id === fieldId);
		if (!field) return;
		updateDefaultField(fieldId, {
			options: (field.options ?? []).filter((_, i) => i !== optIdx)
		});
	}

	// ─── Step 5: FIC mapping ─────────────────────────────────────────────────────

	function updateFic(mi: number, fi: number, val: string) {
		ficMappings = ficMappings.map((m, i) =>
			i === mi ? { ...m, fics: m.fics.map((f, j) => (j === fi ? val : f)) } : m
		);
	}
	function addFic(mi: number) {
		ficMappings = ficMappings.map((m, i) =>
			i === mi ? { ...m, fics: [...m.fics, `FIC ${m.fics.length + 1}`] } : m
		);
	}
	function removeFic(mi: number, fi: number) {
		ficMappings = ficMappings.map((m, i) =>
			i === mi ? { ...m, fics: m.fics.filter((_, j) => j !== fi) } : m
		);
	}
	function resetFicMappings() {
		ficMappings = DEFAULT_FIC_MAPPINGS.map((m) => ({ ...m, fics: [...m.fics] }));
	}

	// ─── Step 6: custom fields ────────────────────────────────────────────────────

	function addCustomField() {
		customFields = [
			...customFields,
			{
				id: createFieldId(),
				name: `custom_${customFields.length + 1}`,
				label: `Custom field ${customFields.length + 1}`,
				type: 'text' as FormFieldType
			}
		];
	}
	function updateCustomField(idx: number, patch: Partial<FormField>) {
		customFields = customFields.map((f, i) => (i === idx ? { ...f, ...patch } : f));
	}
	function removeCustomField(idx: number) {
		customFields = customFields.filter((_, i) => i !== idx);
	}
	function addCustomOption(idx: number) {
		const field = customFields[idx];
		updateCustomField(idx, { options: [...(field.options ?? []), { value: '', label: '' }] });
	}
	function updateCustomOption(idx: number, optIdx: number, key: 'value' | 'label', val: string) {
		const field = customFields[idx];
		updateCustomField(idx, {
			options: (field.options ?? []).map((o, i) => (i === optIdx ? { ...o, [key]: val } : o))
		});
	}
	function removeCustomOption(idx: number, optIdx: number) {
		updateCustomField(idx, {
			options: (customFields[idx].options ?? []).filter((_, i) => i !== optIdx)
		});
	}

	// ─── Build config ─────────────────────────────────────────────────────────────

	function buildConfig() {
		return {
			projectName: projectName.trim() || 'Farm Survey',
			tableName: tableName.trim(),
			fields: exportFields,
			ficMappings,
			basemaps: allBasemaps.length > 0 ? allBasemaps : [BUILTIN_BASEMAPS[0]],
			boundaries,
			keptColumns: keptColumns
		};
	}

	function validateConfig(): string | null {
		if (!tableName.trim()) return 'Enter a layer / table name.';
		const names = exportFields.map((f) => f.name.trim());
		if (names.some((n) => !n)) return 'All fields must have a column name.';
		if (new Set(names).size !== names.length)
			return 'Field column names must be unique.';
		return null;
	}

	// ─── Step 7: Download QGZ ────────────────────────────────────────────────────

	async function handleDownload() {
		const err = validateConfig();
		if (err) { error = err; return; }
		exporting = true;
		error = null;
		try {
			await downloadQgz(buildConfig());
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to export QGZ.';
		} finally {
			exporting = false;
		}
	}

	// ─── Step 7: Push to QField Cloud ────────────────────────────────────────────

	async function handleQfcPush() {
		const err = validateConfig();
		if (err) { error = err; return; }
		if (!qfcToken.trim()) { qfcError = 'Enter your QField Cloud API token.'; return; }
		if (!qfcProjectName.trim()) { qfcError = 'Enter a project name.'; return; }

		qfcPushing = true;
		qfcError = null;
		qfcSuccess = null;
		qfcProgress = 0;
		qfcStatus = 'Generating QGZ…';

		try {
			const config = buildConfig();
			const blob = await exportQgzProject(config);
			qfcProgress = 15;
			const baseName = config.projectName.replace(/[^a-zA-Z0-9_-]/g, '_') || 'farm_survey';
			const fileName = `${baseName}.qgz`;

			const result = await pushToQFieldCloud(
				qfcToken.trim(),
				qfcProjectName.trim(),
				blob,
				fileName,
				(msg, pct) => {
					qfcStatus = msg;
					qfcProgress = 15 + Math.round(pct * 0.85);
				}
			);
			qfcSuccess = result;
		} catch (e) {
			qfcError =
				e instanceof QFieldCloudError
					? e.message
					: e instanceof Error
						? e.message
						: 'Unknown error during push.';
		} finally {
			qfcPushing = false;
		}
	}

	// ─── Helpers ─────────────────────────────────────────────────────────────────

	const fieldClass =
		'rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 w-full focus:outline-none focus:ring-2 focus:ring-blue-400';

	/** Returns true for field types that use an options list. */
	function usesOptions(type: FormFieldType) {
		return type === 'valuemap' || type === 'multiselect';
	}
</script>

<!--
  Outer div captures drag events for step 1 so users can drop a GPKG
  anywhere on the page (not just the drop zone).
-->
<div
	class="min-h-screen"
	role="region"
	aria-label="Form creator"
	ondragover={step === 1 ? handleDragOver : undefined}
	ondragleave={step === 1 ? handleDragLeave : undefined}
	ondrop={step === 1 ? handleDrop : undefined}
>
	<!-- Drop overlay (full-screen) — only while actively dragging in step 1 -->
	{#if dragActive && step === 1}
		<div
			class="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-blue-600/10 backdrop-blur-sm"
		>
			<div
				class="rounded-2xl border-4 border-dashed border-blue-500 bg-white px-12 py-10 text-center shadow-xl"
			>
				<p class="text-xl font-semibold text-blue-700">Drop your GPKG here</p>
				<p class="mt-1 text-sm text-blue-500">GeoJSON is also accepted</p>
			</div>
		</div>
	{/if}

	<main class="mx-auto max-w-7xl p-6">
		<!-- Page header -->
		<header class="mb-6">
			<h1 class="mb-1 text-3xl font-semibold text-slate-900">Form Creator</h1>
			<p class="text-slate-500">
				Build a QField-ready survey form: import plot boundaries, configure columns and fields, then
				export or push a <code class="rounded bg-slate-100 px-1 text-sm">.qgz</code> project.
			</p>
		</header>

		<!-- ── Step indicator ─────────────────────────────────────────────────── -->
		<nav class="mb-8" aria-label="Steps">
			<ol class="flex items-center">
				{#each STEP_LABELS as label, i}
					{@const s = (i + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7}
					{@const isCurrent = step === s}
					{@const isCompleted = s < step}
					{@const isReachable = s <= highestStep}

					<li class="flex items-center {i < STEP_LABELS.length - 1 ? 'flex-1' : ''}">
						<button
							type="button"
							class="flex flex-col items-center gap-1 disabled:cursor-not-allowed"
							onclick={() => goToStep(s)}
							disabled={!isReachable}
							title={isReachable ? label : 'Complete previous steps first'}
						>
							<span
								class="flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors
								{isCurrent
									? 'bg-blue-600 text-white'
									: isCompleted
										? 'bg-emerald-500 text-white'
										: 'bg-slate-200 text-slate-500'}"
							>
								{#if isCompleted}
									<svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
										<path
											fill-rule="evenodd"
											d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
											clip-rule="evenodd"
										/>
									</svg>
								{:else}
									{s}
								{/if}
							</span>
							<span
								class="hidden text-xs font-medium sm:block
								{isCurrent ? 'text-blue-700' : isCompleted ? 'text-emerald-600' : 'text-slate-400'}"
							>
								{label}
							</span>
						</button>

						{#if i < STEP_LABELS.length - 1}
							<div
								class="mx-2 h-0.5 flex-1 transition-colors {s < step
									? 'bg-emerald-400'
									: 'bg-slate-200'}"
							></div>
						{/if}
					</li>
				{/each}
			</ol>
		</nav>

		<!-- ── Error banner ───────────────────────────────────────────────────── -->
		{#if error}
			<div class="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
		{/if}

		<!-- ═══════════════════════════════════════════════════════════════════════
		     STEP 1 — Import Boundaries
		     ═══════════════════════════════════════════════════════════════════════ -->
		{#if step === 1}
			{#if loadingBoundaries}
				<div class="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white py-24 text-slate-500">
					<svg class="mb-3 h-8 w-8 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
					</svg>
					Reading file…
				</div>

			{:else if boundaries.features.length === 0}
				<div
					class="flex flex-col items-center justify-center rounded-xl border-2 border-dashed py-24 text-center transition-colors
					{dragActive ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-white'}"
				>
					<svg
						class="mb-4 h-12 w-12 {dragActive ? 'text-blue-500' : 'text-slate-300'}"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.5"
							d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
						/>
					</svg>
					<p class="text-base font-semibold {dragActive ? 'text-blue-700' : 'text-slate-700'}">
						{dragActive ? 'Drop to import' : 'Drag & drop your .gpkg here'}
					</p>
					<p class="mt-1 text-sm text-slate-400">GeoJSON is also accepted</p>
					<label
						class="mt-6 inline-flex cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
					>
						<input
							type="file"
							accept=".gpkg,.GPKG,.geojson,.json"
							onchange={handleFileInput}
							class="hidden"
						/>
						Browse file
					</label>
				</div>

			{:else}
				<div class="space-y-3">
					<div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
						<div class="flex items-center gap-2 text-emerald-800">
							<svg class="h-5 w-5 shrink-0 text-emerald-500" viewBox="0 0 20 20" fill="currentColor">
								<path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
							</svg>
							<span class="font-semibold">
								{boundaries.features.length} plot{boundaries.features.length === 1 ? '' : 's'} loaded
							</span>
						</div>
						<div class="flex gap-2">
							<label class="cursor-pointer rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-50">
								<input
									type="file"
									accept=".gpkg,.GPKG,.geojson,.json"
									onchange={handleFileInput}
									class="hidden"
								/>
								Replace file
							</label>
							<button
								type="button"
								class="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-500 hover:text-red-600"
								onclick={clearBoundaries}
							>
								Clear
							</button>
						</div>
					</div>
					{#key boundaryVersion}
						<FormCreatorMap {boundaries} />
					{/key}
				</div>
			{/if}

		<!-- ═══════════════════════════════════════════════════════════════════════
		     STEP 2 — Manage Columns
		     ═══════════════════════════════════════════════════════════════════════ -->
		{:else if step === 2}
			<ColumnStep
				{boundaries}
				{columns}
				onColumnsChange={(cols) => (columns = cols)}
			/>

		<!-- ═══════════════════════════════════════════════════════════════════════
		     STEP 3 — Basemap
		     ═══════════════════════════════════════════════════════════════════════ -->
		{:else if step === 3}
			<div class="space-y-4">
				<div>
					<h2 class="text-lg font-semibold text-slate-900">Choose basemaps</h2>
					<p class="mt-0.5 text-sm text-slate-500">
						Select one or more basemaps. Click a row to preview it on the right; tick the checkbox to
						include it. Drag & drop MBTiles or GeoTIFF for offline use.
					</p>
				</div>
				<BasemapStep
					selectedIds={selectedBasemapIds}
					{offlineBasemaps}
					{boundaries}
					onSelectionChange={(ids) => (selectedBasemapIds = ids)}
					onOfflineChange={(files) => (offlineBasemaps = files)}
				/>
			</div>

		<!-- ═══════════════════════════════════════════════════════════════════════
		     STEP 4 — Select default fields
		     ═══════════════════════════════════════════════════════════════════════ -->
		{:else if step === 4}
			<div class="space-y-4">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div>
						<h2 class="text-lg font-semibold text-slate-900">Select default fields</h2>
						<p class="mt-0.5 text-sm text-slate-500">
							Choose which pre-configured fields to include. You can edit labels and options in the next step.
						</p>
					</div>
					<div class="flex gap-2">
						<button type="button" class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50" onclick={selectAll}>
							Select all
						</button>
						<button type="button" class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50" onclick={deselectAll}>
							Select none
						</button>
					</div>
				</div>

				<div class="grid gap-3 sm:grid-cols-2">
					{#each allDefaultFields as field}
						{@const isSelected = selectedDefaultIds.has(field.id)}
						<label
							class="flex cursor-pointer items-start gap-3 rounded-xl border-2 p-4 transition-all
							{isSelected ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'}"
						>
							<input
								type="checkbox"
								class="mt-0.5 h-4 w-4 rounded border-slate-300 accent-blue-600"
								checked={isSelected}
								onchange={() => toggleDefault(field.id)}
							/>
							<div class="min-w-0">
								<p class="font-semibold text-slate-900">{field.label}</p>
								<p class="mt-0.5 text-xs text-slate-500">{FIELD_DESCRIPTIONS[field.name] ?? field.type}</p>
								<code class="mt-1 block text-xs text-slate-400">{field.name}</code>
							</div>
						</label>
					{/each}
				</div>

				{#if selectedDefaultIds.size === 0}
					<div class="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
						No default fields selected. You can add custom fields in step 6, or go back and select some defaults.
					</div>
				{/if}
			</div>

		<!-- ═══════════════════════════════════════════════════════════════════════
		     STEP 5 — Edit selected defaults
		     ═══════════════════════════════════════════════════════════════════════ -->
		{:else if step === 5}
			<div class="space-y-4">
				<div>
					<h2 class="text-lg font-semibold text-slate-900">Edit default fields</h2>
					<p class="mt-0.5 text-sm text-slate-500">
						Customise labels, column names, and dropdown options. Changes are preserved even when navigating back.
					</p>
				</div>

				{#if selectedDefaults.length === 0}
					<div class="rounded-xl border border-slate-200 bg-slate-50 px-6 py-10 text-center">
						<p class="text-slate-500">No default fields selected.</p>
						<button
							type="button"
							class="mt-3 text-sm font-semibold text-blue-600 hover:text-blue-800"
							onclick={() => goToStep(4)}
						>
							← Go back and select fields
						</button>
					</div>
				{:else}
					{#if hasFicWithoutLateral}
						<div class="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
							The <strong>FIC</strong> field is selected but <strong>Lateral</strong> is not. The FIC
							dropdown won't filter without a Lateral field.
						</div>
					{/if}

					<div class="space-y-4">
						{#each selectedDefaults as field}
							<div class="rounded-xl border border-slate-200 bg-white p-5">
								<div class="mb-4 flex items-center justify-between gap-2">
									<div class="flex items-center gap-2">
										<span class="font-semibold text-slate-900">{field.label}</span>
										<span class="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700">default</span>
									</div>
									<button type="button" class="text-xs text-slate-400 hover:text-red-600" onclick={() => toggleDefault(field.id)}>Remove</button>
								</div>

								<div class="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
									<label class="grid gap-1 text-sm">
										<span class="font-medium text-slate-600">Column name</span>
										<input type="text" class={fieldClass} value={field.name} oninput={(e) => updateDefaultField(field.id, { name: (e.target as HTMLInputElement).value })} />
									</label>
									<label class="grid gap-1 text-sm">
										<span class="font-medium text-slate-600">Display label</span>
										<input type="text" class={fieldClass} value={field.label} oninput={(e) => updateDefaultField(field.id, { label: (e.target as HTMLInputElement).value })} />
									</label>
									<label class="grid gap-1 text-sm">
										<span class="font-medium text-slate-600">Widget type</span>
										<select class={fieldClass} value={field.type} onchange={(e) => updateDefaultField(field.id, { type: (e.target as HTMLSelectElement).value as FormFieldType })}>
											{#each CUSTOM_FIELD_TYPES as ft}
												<option value={ft.value}>{ft.label}</option>
											{/each}
											{#if field.type === 'valuerelation'}
												<option value="valuerelation">Value relation (FIC lookup)</option>
											{/if}
										</select>
									</label>
									<label class="flex items-center gap-2 self-end pb-2 text-sm">
										<input type="checkbox" class="h-4 w-4 rounded accent-blue-600" checked={field.required ?? false} onchange={(e) => updateDefaultField(field.id, { required: (e.target as HTMLInputElement).checked })} />
										<span class="text-slate-700">Required</span>
									</label>
								</div>

								{#if usesOptions(field.type) && field.options !== undefined}
									<div class="mt-4 border-t border-slate-100 pt-4">
										<p class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
											{field.type === 'multiselect' ? 'Checkbox options' : 'Dropdown options'}
										</p>
										<div class="space-y-2">
											{#each field.options as opt, oi}
												<div class="flex items-center gap-2">
													<input type="text" class="{fieldClass} flex-1" placeholder="Stored value" value={opt.value} oninput={(e) => updateDefaultOption(field.id, oi, 'value', (e.target as HTMLInputElement).value)} />
													<input type="text" class="{fieldClass} flex-1" placeholder="Displayed label" value={opt.label} oninput={(e) => updateDefaultOption(field.id, oi, 'label', (e.target as HTMLInputElement).value)} />
													<button type="button" class="shrink-0 text-slate-400 hover:text-red-600" onclick={() => removeDefaultOption(field.id, oi)} aria-label="Remove option">✕</button>
												</div>
											{/each}
											<button type="button" class="mt-1 text-sm font-semibold text-blue-600 hover:text-blue-800" onclick={() => addDefaultOption(field.id)}>
												+ Add option
											</button>
										</div>
									</div>
								{/if}
							</div>
						{/each}
					</div>

					<!-- FIC mapping -->
					{#if showFicMapping}
						<div class="rounded-xl border border-slate-200 bg-white p-5">
							<div class="mb-4 flex items-center justify-between">
								<div>
									<h3 class="font-semibold text-slate-900">Lateral → FIC mapping</h3>
									<p class="mt-0.5 text-xs text-slate-500">Define which FICs belong to each lateral.</p>
								</div>
								<button type="button" class="text-xs text-slate-400 hover:text-blue-600" onclick={resetFicMappings}>Reset defaults</button>
							</div>
							<div class="space-y-4">
								{#each ficMappings as mapping, mi}
									<div>
										<p class="mb-2 text-sm font-semibold text-slate-700">{mapping.lateral}</p>
										<div class="flex flex-wrap gap-2">
											{#each mapping.fics as fic, fi}
												<div class="flex items-center gap-1">
													<input type="text" class="w-24 rounded border border-slate-300 bg-white px-2 py-1 text-sm" value={fic} oninput={(e) => updateFic(mi, fi, (e.target as HTMLInputElement).value)} />
													<button type="button" class="text-slate-400 hover:text-red-600" onclick={() => removeFic(mi, fi)} aria-label="Remove FIC">✕</button>
												</div>
											{/each}
											<button type="button" class="rounded border border-dashed border-slate-300 px-2 py-1 text-sm text-slate-500 hover:border-blue-400 hover:text-blue-600" onclick={() => addFic(mi)}>
												+ FIC
											</button>
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				{/if}
			</div>

		<!-- ═══════════════════════════════════════════════════════════════════════
		     STEP 6 — Custom fields
		     ═══════════════════════════════════════════════════════════════════════ -->
		{:else if step === 6}
			<div class="space-y-4">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div>
						<h2 class="text-lg font-semibold text-slate-900">Custom fields</h2>
						<p class="mt-0.5 text-sm text-slate-500">
							Add any additional fields in whatever format QGIS supports. Multi-select fields use a
							checkbox group in QField.
						</p>
					</div>
					<button
						type="button"
						class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
						onclick={addCustomField}
					>
						+ Add field
					</button>
				</div>

				{#if customFields.length === 0}
					<div class="rounded-xl border border-slate-200 bg-slate-50 px-6 py-10 text-center text-sm text-slate-500">
						No custom fields yet. Click "Add field" to create one, or proceed to the next step.
					</div>
				{:else}
					<div class="space-y-4">
						{#each customFields as field, idx}
							<div class="rounded-xl border border-slate-200 bg-white p-5">
								<div class="mb-4 flex items-center justify-between">
									<span class="font-semibold text-slate-900">{field.label || `Field ${idx + 1}`}</span>
									<button type="button" class="text-xs text-slate-400 hover:text-red-600" onclick={() => removeCustomField(idx)}>Remove</button>
								</div>

								<div class="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
									<label class="grid gap-1 text-sm">
										<span class="font-medium text-slate-600">Column name</span>
										<input type="text" class={fieldClass} value={field.name} oninput={(e) => updateCustomField(idx, { name: (e.target as HTMLInputElement).value })} />
									</label>
									<label class="grid gap-1 text-sm">
										<span class="font-medium text-slate-600">Display label</span>
										<input type="text" class={fieldClass} value={field.label} oninput={(e) => updateCustomField(idx, { label: (e.target as HTMLInputElement).value })} />
									</label>
									<label class="grid gap-1 text-sm">
										<span class="font-medium text-slate-600">Field type</span>
										<select
											class={fieldClass}
											value={field.type}
											onchange={(e) => {
												const newType = (e.target as HTMLSelectElement).value as FormFieldType;
												const patch: Partial<FormField> = { type: newType };
												if (usesOptions(newType) && !field.options) patch.options = [];
												updateCustomField(idx, patch);
											}}
										>
											{#each CUSTOM_FIELD_TYPES as ft}
												<option value={ft.value}>{ft.label}</option>
											{/each}
										</select>
									</label>
									<label class="flex items-center gap-2 self-end pb-2 text-sm">
										<input type="checkbox" class="h-4 w-4 rounded accent-blue-600" checked={field.required ?? false} onchange={(e) => updateCustomField(idx, { required: (e.target as HTMLInputElement).checked })} />
										<span class="text-slate-700">Required</span>
									</label>
								</div>

								<!-- Options editor for valuemap and multiselect -->
								{#if usesOptions(field.type)}
									<div class="mt-4 border-t border-slate-100 pt-4">
										<div class="mb-2 flex items-center gap-2">
											<p class="text-xs font-semibold uppercase tracking-wide text-slate-500">
												{field.type === 'multiselect' ? 'Checkbox options' : 'Dropdown options'}
											</p>
											{#if field.type === 'multiselect'}
												<span class="rounded bg-purple-100 px-1.5 py-0.5 text-xs text-purple-700">multi-select</span>
											{/if}
										</div>
										<div class="space-y-2">
											{#each field.options ?? [] as opt, oi}
												<div class="flex items-center gap-2">
													<input type="text" class="{fieldClass} flex-1" placeholder="Stored value" value={opt.value} oninput={(e) => updateCustomOption(idx, oi, 'value', (e.target as HTMLInputElement).value)} />
													<input type="text" class="{fieldClass} flex-1" placeholder="Displayed label" value={opt.label} oninput={(e) => updateCustomOption(idx, oi, 'label', (e.target as HTMLInputElement).value)} />
													<button type="button" class="shrink-0 text-slate-400 hover:text-red-600" onclick={() => removeCustomOption(idx, oi)}>✕</button>
												</div>
											{/each}
											<button type="button" class="mt-1 text-sm font-semibold text-blue-600 hover:text-blue-800" onclick={() => addCustomOption(idx)}>
												+ Add option
											</button>
										</div>
										{#if (field.options ?? []).length === 0}
											<p class="mt-2 text-xs text-amber-600">Add at least one option before exporting.</p>
										{/if}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>

		<!-- ═══════════════════════════════════════════════════════════════════════
		     STEP 7 — Summary + Export
		     ═══════════════════════════════════════════════════════════════════════ -->
		{:else if step === 7}
			<div class="space-y-6">
				<!-- Project settings -->
				<div class="rounded-xl border border-slate-200 bg-white p-5">
					<h2 class="mb-4 text-lg font-semibold text-slate-900">Project settings</h2>
					<div class="grid gap-4 sm:grid-cols-2">
						<label class="grid gap-1.5 text-sm">
							<span class="font-medium text-slate-700">Project name</span>
							<input type="text" class={fieldClass} bind:value={projectName} placeholder="Farm Survey" />
						</label>
						<label class="grid gap-1.5 text-sm">
							<span class="font-medium text-slate-700">Layer / table name</span>
							<input type="text" class={fieldClass} bind:value={tableName} placeholder="farm_plots" />
							<span class="text-xs text-slate-400">Used in QGIS/QField as the layer name. No spaces.</span>
						</label>
					</div>
				</div>

				<!-- Full project summary -->
				<div class="rounded-xl border border-slate-200 bg-white p-5">
					<h2 class="mb-4 text-lg font-semibold text-slate-900">Project summary</h2>
					<dl class="divide-y divide-slate-100">
						<!-- Boundaries -->
						<div class="flex items-start gap-4 py-3">
							<dt class="w-40 shrink-0 text-sm font-medium text-slate-500">Plots</dt>
							<dd class="text-sm text-slate-800">
								{boundaries.features.length} plot{boundaries.features.length === 1 ? '' : 's'} imported
							</dd>
						</div>
						<!-- Columns -->
						<div class="flex items-start gap-4 py-3">
							<dt class="w-40 shrink-0 text-sm font-medium text-slate-500">Kept columns</dt>
							<dd class="text-sm text-slate-800">
								<div class="flex flex-wrap gap-1.5">
									{#each keptColumns as col}
										<span class="rounded px-1.5 py-0.5 text-xs font-mono
											{col.role === 'id' ? 'bg-blue-100 text-blue-700'
											: col.role === 'area' ? 'bg-emerald-100 text-emerald-700'
											: 'bg-slate-100 text-slate-600'}">
											{col.name}{col.role !== 'none' ? ` (${col.role})` : ''}
										</span>
									{/each}
									{#if keptColumns.length === 0}
										<span class="text-slate-400 text-xs">none</span>
									{/if}
								</div>
							</dd>
						</div>
						<!-- Basemaps -->
						<div class="flex items-start gap-4 py-3">
							<dt class="w-40 shrink-0 text-sm font-medium text-slate-500">Basemaps</dt>
							<dd class="text-sm text-slate-800">
								<div class="flex flex-wrap gap-1.5">
									{#each allBasemaps as bm}
										<span class="flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
											{bm.label}
											{#if bm.requiresInternet}
												<span class="text-orange-500" title="Requires internet">🌐</span>
											{:else}
												<span class="text-emerald-500" title="Offline">✓</span>
											{/if}
										</span>
									{/each}
									{#if allBasemaps.length === 0}
										<span class="text-xs text-slate-400">OSM (default)</span>
									{/if}
								</div>
							</dd>
						</div>
						<!-- Form fields -->
						<div class="flex items-start gap-4 py-3">
							<dt class="w-40 shrink-0 text-sm font-medium text-slate-500">Form fields</dt>
							<dd class="text-sm text-slate-800">
								<p class="mb-1 text-slate-500">
									{exportFields.length} field{exportFields.length === 1 ? '' : 's'}
									({selectedDefaults.length} default{selectedDefaults.length === 1 ? '' : 's'} + {customFields.length} custom)
								</p>
								<div class="flex flex-wrap gap-1.5">
									{#each exportFields as f}
										<span class="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-mono
											{f.isDefault ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'}">
											{f.name}
											<span class="text-xs opacity-60">({f.type})</span>
										</span>
									{/each}
								</div>
							</dd>
						</div>
						{#if hasMultiselect}
							<div class="flex items-start gap-4 py-3">
								<dt class="w-40 shrink-0 text-sm font-medium text-slate-500">Multi-select</dt>
								<dd class="text-sm text-slate-800">
									{exportFields.filter(f => f.type === 'multiselect').map(f => f.name).join(', ')} — stored as JSON array in GPKG, checkbox group in QField.
								</dd>
							</div>
						{/if}
					</dl>
				</div>

				<!-- ── Download QGZ ────────────────────────────────────────────── -->
				<div class="rounded-xl border border-slate-200 bg-white p-5">
					<h2 class="mb-1 text-base font-semibold text-slate-900">Download QGZ</h2>
					<p class="mb-4 text-sm text-slate-500">
						Export the project as a <code class="rounded bg-slate-100 px-1">.qgz</code> file. Open it in QField on your device to start collecting data.
					</p>
					{#if error}
						<div class="mb-3 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-800">{error}</div>
					{/if}
					<button
						type="button"
						class="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
						onclick={handleDownload}
						disabled={exporting}
					>
						{#if exporting}
							<svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
								<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
							</svg>
							Exporting…
						{:else}
							<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
							</svg>
							Download .qgz
						{/if}
					</button>
				</div>

				<!-- ── Push to QField Cloud ────────────────────────────────────── -->
				<div class="rounded-xl border border-slate-200 bg-white p-5">
					<h2 class="mb-1 text-base font-semibold text-slate-900">Push to QField Cloud</h2>
					<p class="mb-4 text-sm text-slate-500">
						Upload directly to <a href="https://app.qfield.cloud" target="_blank" class="text-blue-600 underline">QField Cloud</a>. You can find your API token in
						<em>Account → Settings → API Token</em>.
					</p>

					<div class="space-y-3">
						<label class="grid gap-1.5 text-sm">
							<span class="font-medium text-slate-700">API Token</span>
							<input
								type="password"
								class={fieldClass}
								bind:value={qfcToken}
								placeholder="Paste your QField Cloud token here"
								autocomplete="off"
							/>
						</label>
						<label class="grid gap-1.5 text-sm">
							<span class="font-medium text-slate-700">Project name on QField Cloud</span>
							<input
								type="text"
								class={fieldClass}
								bind:value={qfcProjectName}
								placeholder={projectName || 'Farm Survey'}
							/>
							<span class="text-xs text-slate-400">A new project will be created if one with this name doesn't exist.</span>
						</label>

						{#if qfcError}
							<div class="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-800">{qfcError}</div>
						{/if}

						{#if qfcPushing || qfcProgress > 0}
							<div class="space-y-1">
								<div class="flex items-center justify-between text-xs text-slate-500">
									<span>{qfcStatus}</span>
									<span>{qfcProgress}%</span>
								</div>
								<div class="h-2 overflow-hidden rounded-full bg-slate-200">
									<div
										class="h-full rounded-full bg-blue-500 transition-all duration-300"
										style="width: {qfcProgress}%"
									></div>
								</div>
							</div>
						{/if}

						{#if qfcSuccess}
							<div class="rounded-lg bg-emerald-50 px-4 py-3 text-sm">
								<p class="font-semibold text-emerald-800">Successfully pushed!</p>
								<a
									href={qfcSuccess.projectUrl}
									target="_blank"
									class="mt-1 block text-emerald-700 underline"
								>
									Open project on QField Cloud →
								</a>
							</div>
						{/if}

						<button
							type="button"
							class="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
							onclick={handleQfcPush}
							disabled={qfcPushing}
						>
							{#if qfcPushing}
								<svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
									<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
									<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
								</svg>
								Pushing…
							{:else}
								<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
								</svg>
								Push to QField Cloud
							{/if}
						</button>
					</div>
				</div>
			</div>
		{/if}

		<!-- ── Step navigation ────────────────────────────────────────────────── -->
		<div class="mt-8 flex items-center justify-between gap-4">
			{#if step > 1}
				<button
					type="button"
					class="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
					onclick={back}
				>
					← Back
				</button>
			{:else}
				<div></div>
			{/if}

			{#if step < 7}
				<button
					type="button"
					class="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
					onclick={advance}
				>
					Next →
				</button>
			{:else}
				<!-- On step 7, navigation is handled by the inline buttons above -->
				<div></div>
			{/if}
		</div>
	</main>
</div>
