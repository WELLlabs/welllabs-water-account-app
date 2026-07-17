<script lang="ts">
	import type { ColumnConfig } from '$lib/formCreator/types';
	import {
		generatePlotIds,
		generateAreaAcres,
		assignIdColumn,
		assignAreaColumn,
		addGeneratedColumn
	} from '$lib/formCreator/columnUtils';

	interface Props {
		boundaries: GeoJSON.FeatureCollection;
		columns: ColumnConfig[];
		onColumnsChange: (cols: ColumnConfig[]) => void;
	}

	let { boundaries, columns, onColumnsChange }: Props = $props();

	const idCol = $derived(columns.find((c) => c.role === 'id'));
	const areaCol = $derived(columns.find((c) => c.role === 'area'));

	let idMode = $state<'select' | 'generate'>('generate');
	let areaMode = $state<'select' | 'generate'>('generate');

	const featureCount = $derived(boundaries.features.length);
	const keptCount = $derived(columns.filter((c) => c.keep).length);

	function toggleKeep(col: ColumnConfig) {
		if (col.locked) return;
		onColumnsChange(columns.map((c) => (c.name === col.name ? { ...c, keep: !c.keep } : c)));
	}

	function handleIdSelect(name: string) {
		onColumnsChange(assignIdColumn(columns, name));
	}

	function handleAreaSelect(name: string) {
		onColumnsChange(assignAreaColumn(columns, name));
	}

	function handleGenerateId() {
		// Mutate the boundaries in place to add P-001 etc. then add to columns
		const colName = generatePlotIds(boundaries);
		const digits = String(featureCount).length;
		const sample = featureCount > 0 ? `P-${'1'.padStart(digits, '0')}` : 'P-01';
		onColumnsChange(addGeneratedColumn(columns, colName, 'id', sample));
	}

	function handleGenerateArea() {
		const colName = generateAreaAcres(boundaries);
		// Sample from first feature
		const sample = boundaries.features[0]?.properties?.[colName]
			? String(boundaries.features[0].properties[colName]) + ' ac'
			: '–';
		onColumnsChange(addGeneratedColumn(columns, colName, 'area', sample));
	}

	// Trigger generation when mode switches to 'generate'
	$effect(() => {
		if (idMode === 'generate' && !columns.find((c) => c.role === 'id' && c.name === 'plot_id')) {
			handleGenerateId();
		}
	});

	$effect(() => {
		if (areaMode === 'generate' && !columns.find((c) => c.role === 'area' && c.name === 'area_acres')) {
			handleGenerateArea();
		}
	});

	const selectableForId = $derived(
		columns.filter((c) => c.role !== 'area')
	);
	const selectableForArea = $derived(
		columns.filter((c) => c.role !== 'id')
	);
</script>

<div class="space-y-6">
	<!-- Header summary -->
	<div class="rounded-xl border border-slate-200 bg-white p-5">
		<h2 class="mb-1 text-lg font-semibold text-slate-900">Manage Columns</h2>
		<p class="text-sm text-slate-500">
			{featureCount} plot{featureCount === 1 ? '' : 's'} imported ·
			{keptCount} of {columns.length} column{columns.length === 1 ? '' : 's'} kept
		</p>
	</div>

	<!-- Mandatory: ID column -->
	<div class="rounded-xl border border-blue-200 bg-blue-50 p-5">
		<h3 class="mb-1 font-semibold text-blue-900">Plot ID Column <span class="ml-1 text-xs font-normal text-blue-700">(required)</span></h3>
		<p class="mb-4 text-sm text-blue-700">Each plot must have a unique identifier. This column is locked and cannot be removed.</p>
		<div class="mb-3 flex gap-4">
			<label class="flex cursor-pointer items-center gap-2 text-sm font-medium text-blue-900">
				<input
					type="radio"
					bind:group={idMode}
					value="generate"
					class="accent-blue-600"
				/>
				Generate automatically <span class="font-normal text-blue-600">(P-001, P-002…)</span>
			</label>
			{#if columns.filter((c) => c.role !== 'area').length > 0}
				<label class="flex cursor-pointer items-center gap-2 text-sm font-medium text-blue-900">
					<input
						type="radio"
						bind:group={idMode}
						value="select"
						class="accent-blue-600"
					/>
					Use existing column
				</label>
			{/if}
		</div>
		{#if idMode === 'select'}
			<select
				class="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
				onchange={(e) => handleIdSelect((e.target as HTMLSelectElement).value)}
				value={idCol?.name ?? ''}
			>
				<option value="" disabled>— select a column —</option>
				{#each selectableForId as col}
					<option value={col.name}>{col.name} {col.sample ? `(e.g. ${col.sample})` : ''}</option>
				{/each}
			</select>
		{:else if idCol}
			<div class="flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm">
				<span class="font-mono font-medium text-slate-800">{idCol.name}</span>
				<span class="text-slate-400">—</span>
				<span class="text-slate-500">e.g. {idCol.sample}</span>
				<span class="ml-auto rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">auto-generated</span>
			</div>
		{/if}
	</div>

	<!-- Mandatory: Area column -->
	<div class="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
		<h3 class="mb-1 font-semibold text-emerald-900">Plot Area Column <span class="ml-1 text-xs font-normal text-emerald-700">(required)</span></h3>
		<p class="mb-4 text-sm text-emerald-700">Area in acres for each plot. This column is locked and cannot be removed.</p>
		<div class="mb-3 flex gap-4">
			<label class="flex cursor-pointer items-center gap-2 text-sm font-medium text-emerald-900">
				<input
					type="radio"
					bind:group={areaMode}
					value="generate"
					class="accent-emerald-600"
				/>
				Calculate from geometry <span class="font-normal text-emerald-600">(in acres)</span>
			</label>
			{#if columns.filter((c) => c.role !== 'id').length > 0}
				<label class="flex cursor-pointer items-center gap-2 text-sm font-medium text-emerald-900">
					<input
						type="radio"
						bind:group={areaMode}
						value="select"
						class="accent-emerald-600"
					/>
					Use existing column
				</label>
			{/if}
		</div>
		{#if areaMode === 'select'}
			<select
				class="w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-400"
				onchange={(e) => handleAreaSelect((e.target as HTMLSelectElement).value)}
				value={areaCol?.name ?? ''}
			>
				<option value="" disabled>— select a column —</option>
				{#each selectableForArea as col}
					<option value={col.name}>{col.name} {col.sample ? `(e.g. ${col.sample})` : ''}</option>
				{/each}
			</select>
		{:else if areaCol}
			<div class="flex items-center gap-2 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm">
				<span class="font-mono font-medium text-slate-800">{areaCol.name}</span>
				<span class="text-slate-400">—</span>
				<span class="text-slate-500">e.g. {areaCol.sample}</span>
				<span class="ml-auto rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-700">calculated</span>
			</div>
		{/if}
	</div>

	<!-- Optional columns from the file -->
	{#if columns.filter((c) => c.role === 'none').length > 0}
		<div class="rounded-xl border border-slate-200 bg-white p-5">
			<div class="mb-4 flex items-center justify-between gap-3">
				<div>
					<h3 class="font-semibold text-slate-900">Other Columns</h3>
					<p class="mt-0.5 text-sm text-slate-500">
						Toggle to keep or discard each column in the exported GPKG.
					</p>
				</div>
				<div class="flex gap-2">
					<button
						type="button"
						class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
						onclick={() => onColumnsChange(columns.map((c) => c.locked ? c : { ...c, keep: true }))}
					>
						Keep all
					</button>
					<button
						type="button"
						class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
						onclick={() => onColumnsChange(columns.map((c) => c.locked ? c : { ...c, keep: false }))}
					>
						Discard all
					</button>
				</div>
			</div>
			<div class="overflow-hidden rounded-lg border border-slate-200">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b border-slate-200 bg-slate-50">
							<th class="px-4 py-2.5 text-left font-medium text-slate-600">Column</th>
							<th class="px-4 py-2.5 text-left font-medium text-slate-600">Sample value</th>
							<th class="px-4 py-2.5 text-center font-medium text-slate-600">Keep</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each columns.filter((c) => c.role === 'none') as col}
							<tr class={col.keep ? '' : 'opacity-50'}>
								<td class="px-4 py-2.5 font-mono text-slate-800">{col.name}</td>
								<td class="px-4 py-2.5 text-slate-500 truncate max-w-xs">{col.sample || '—'}</td>
								<td class="px-4 py-2.5 text-center">
									<button
										type="button"
										class="relative inline-flex h-5 w-9 cursor-pointer rounded-full transition-colors {col.keep ? 'bg-blue-600' : 'bg-slate-300'}"
										onclick={() => toggleKeep(col)}
										aria-label={col.keep ? 'Remove column' : 'Keep column'}
									>
										<span
											class="inline-block h-4 w-4 translate-y-0.5 transform rounded-full bg-white shadow transition-transform {col.keep ? 'translate-x-4' : 'translate-x-0.5'}"
										></span>
									</button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/if}
</div>
