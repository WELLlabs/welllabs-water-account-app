<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ScenarioPlanner from '$lib/components/cropcalc/ScenarioPlanner.svelte';
	import RegionWaterBudget from '$lib/components/cropcalc/RegionWaterBudget.svelte';

	type Mode = 'planner' | 'budget';

	const TABS: { id: Mode; label: string; hint: string }[] = [
		{ id: 'planner', label: 'Scenario planner', hint: 'Plan a crop mix and its water need' },
		{ id: 'budget', label: 'Water budget estimation', hint: 'Upload a boundary, detect crops, total the water' }
	];

	const mode = $derived<Mode>(page.url.searchParams.get('mode') === 'budget' ? 'budget' : 'planner');
	let budgetVisited = $state(false);
	$effect(() => {
		if (mode === 'budget') budgetVisited = true;
	});

	function select(next: Mode) {
		const url = new URL(page.url);
		if (next === 'planner') url.searchParams.delete('mode');
		else url.searchParams.set('mode', next);
		goto(url, { replaceState: true, keepFocus: true, noScroll: true });
	}
</script>

<div class="min-h-screen bg-slate-50">
	<div class="border-b border-slate-200 bg-white px-6 pt-5">
		<div class="mx-auto max-w-7xl">
			<h1 class="text-2xl font-semibold text-slate-900">Crop Water Calculator</h1>
			<div class="mt-4 flex gap-1" role="tablist" aria-label="Crop calculator mode">
				{#each TABS as tab}
					<button
						type="button"
						role="tab"
						aria-selected={mode === tab.id}
						title={tab.hint}
						onclick={() => select(tab.id)}
						class="-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors
						{mode === tab.id
							? 'border-blue-600 text-blue-700'
							: 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'}"
					>
						{tab.label}
					</button>
				{/each}
			</div>
		</div>
	</div>

	<div class:hidden={mode !== 'planner'}>
		<ScenarioPlanner />
	</div>
	{#if budgetVisited}
		<div class:hidden={mode !== 'budget'}>
			<RegionWaterBudget />
		</div>
	{/if}
</div>
