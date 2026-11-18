<script module lang="ts">
	export interface BoundaryItem {
		id: string;
		name: string;
		state: string;
		district: string;
		areaKm2: number;
		type?: string;
		status?: string;
		parts?: number;
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';

	interface Props {
		dataset: 'districts' | 'commands';
		placeholder: string;
		/** Area above which the explorer cannot query a boundary (S2 cell limit) */
		maxKm2: number;
		busy?: boolean;
		onpick: (item: BoundaryItem, boundary: GeoJSON.FeatureCollection) => void | Promise<void>;
	}

	let { dataset, placeholder, maxKm2, busy = false, onpick }: Props = $props();

	const LIMIT = 80;

	let items = $state.raw<BoundaryItem[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let query = $state('');
	let active = $state(0);
	let picking = $state<string | null>(null);
	let listEl = $state<HTMLUListElement | null>(null);
	let inputEl = $state<HTMLInputElement | null>(null);

	const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\w\s]/g, ' ');
	const haystacks = $derived(items.map((i) => norm(`${i.name} ${i.district} ${i.state} ${i.type ?? ''} ${i.id}`)));

	const matches = $derived.by(() => {
		const tokens = norm(query).split(/\s+/).filter(Boolean);
		if (!tokens.length) return items;
		const out: BoundaryItem[] = [];
		// Names that start with the query first, then any match
		const starts: BoundaryItem[] = [];
		const q = norm(query).trim();
		for (let i = 0; i < items.length; i++) {
			const h = haystacks[i];
			if (!tokens.every((t) => h.includes(t))) continue;
			(norm(items[i].name).startsWith(q) ? starts : out).push(items[i]);
		}
		return [...starts, ...out];
	});
	const shown = $derived(matches.slice(0, LIMIT));

	$effect(() => {
		void query;
		active = 0;
	});

	onMount(async () => {
		try {
			const res = await fetch(`/fwa-api/boundaries/${dataset}`);
			const body = await res.json().catch(() => null);
			if (!res.ok) throw new Error(body?.detail ?? `HTTP ${res.status}`);
			items = body.items;
		} catch (e) {
			error = `Could not load the list: ${e instanceof Error ? e.message : String(e)}`;
		} finally {
			loading = false;
			inputEl?.focus();
		}
	});

	async function pick(item: BoundaryItem) {
		if (picking || busy) return;
		picking = item.id;
		error = null;
		try {
			const res = await fetch(`/fwa-api/boundaries/${dataset}/${encodeURIComponent(item.id)}`);
			const body = await res.json().catch(() => null);
			if (!res.ok) throw new Error(body?.detail ?? `HTTP ${res.status}`);
			await onpick(item, body as GeoJSON.FeatureCollection);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			picking = null;
		}
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			const n = shown.length;
			if (!n) return;
			active = (active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
			listEl?.querySelectorAll('li')[active]?.scrollIntoView({ block: 'nearest' });
		} else if (e.key === 'Enter' && shown[active]) {
			e.preventDefault();
			void pick(shown[active]);
		}
	}

	function meta(i: BoundaryItem): string {
		const parts = [];
		if (i.district && i.district !== i.name) parts.push(i.district);
		if (i.state) parts.push(i.state);
		if (i.type) parts.push(i.type);
		if (i.status) parts.push(i.status);
		if (i.parts && i.parts > 1) parts.push(`${i.parts} parts`);
		return parts.join(' · ');
	}

	const km2 = (v: number) => `${v.toLocaleString('en-IN', { maximumFractionDigits: v < 100 ? 1 : 0 })} km²`;
</script>

<div class="bp">
	<input
		bind:this={inputEl}
		bind:value={query}
		type="search"
		{placeholder}
		disabled={loading}
		autocomplete="off"
		spellcheck="false"
		role="combobox"
		aria-expanded="true"
		aria-controls="bp-list-{dataset}"
		aria-activedescendant={shown[active] ? `bp-${dataset}-${shown[active].id}` : undefined}
		onkeydown={onKey}
	/>
	{#if loading}
		<p class="bp-note">Loading the list…</p>
	{:else}
		<ul class="bp-list" id="bp-list-{dataset}" role="listbox" bind:this={listEl}>
			{#each shown as item, i (item.id)}
				{@const big = item.areaKm2 > maxKm2}
				<li
					id="bp-{dataset}-{item.id}"
					role="option"
					aria-selected={i === active}
					class:active={i === active}
					class:big
					onmousemove={() => (active = i)}
					onclick={() => pick(item)}
					onkeydown={() => {}}
				>
					<div class="bp-main">
						<strong>{item.name}</strong>
						<span>{meta(item)}</span>
					</div>
					<div class="bp-area">
						{#if picking === item.id}
							Loading…
						{:else}
							{km2(item.areaKm2)}
							{#if big}<em>too large</em>{/if}
						{/if}
					</div>
				</li>
			{:else}
				<li class="bp-empty">No matches</li>
			{/each}
		</ul>
		<p class="bp-note">
			{#if matches.length > LIMIT}
				Showing {LIMIT} of {matches.length.toLocaleString('en-IN')}; type more to narrow it down.
			{:else}
				{matches.length.toLocaleString('en-IN')} of {items.length.toLocaleString('en-IN')}
			{/if}
		</p>
	{/if}
	{#if error}<p class="bp-error">{error}</p>{/if}
</div>

<style>
	.bp {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		text-align: left;
	}

	input {
		width: 100%;
		box-sizing: border-box;
		border: 1px solid color-mix(in srgb, #00296b 20%, white);
		border-radius: 0.5rem;
		padding: 0.65rem 0.8rem;
		font: inherit;
		font-size: 0.9rem;
		color: #00296b;
	}

	input:focus {
		outline: 2px solid color-mix(in srgb, #1b75e0 40%, white);
		border-color: #1b75e0;
	}

	.bp-list {
		list-style: none;
		margin: 0;
		padding: 0.25rem;
		height: 18rem;
		overflow-y: auto;
		border: 1px solid color-mix(in srgb, #00296b 10%, white);
		border-radius: 0.5rem;
	}

	.bp-list li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
		padding: 0.45rem 0.6rem;
		border-radius: 0.4rem;
		cursor: pointer;
	}

	.bp-list li.active {
		background: color-mix(in srgb, #1b75e0 10%, white);
	}

	.bp-main {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.bp-main strong {
		font-size: 0.85rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.bp-main span {
		font-size: 0.7rem;
		color: color-mix(in srgb, #00296b 60%, white);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.bp-area {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		font-size: 0.72rem;
		font-variant-numeric: tabular-nums;
		color: color-mix(in srgb, #00296b 70%, white);
	}

	.bp-area em {
		font-style: normal;
		font-size: 0.65rem;
		font-weight: 700;
		color: #b45309;
	}

	li.big strong {
		color: color-mix(in srgb, #00296b 60%, white);
	}

	.bp-empty {
		justify-content: center !important;
		cursor: default !important;
		font-size: 0.8rem;
		color: color-mix(in srgb, #00296b 55%, white);
	}

	.bp-note {
		margin: 0;
		font-size: 0.7rem;
		color: color-mix(in srgb, #00296b 55%, white);
	}

	.bp-error {
		margin: 0;
		font-size: 0.8rem;
		color: #b91c1c;
	}
</style>
