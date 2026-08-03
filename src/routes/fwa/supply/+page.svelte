<script lang="ts">
	import { onMount } from 'svelte';

	interface SupplyParam {
		id: string;
		name: string;
		mm: number;
		minMm: number;
		maxMm: number;
		color: string;
		kind: 'inflow' | 'outflow' | 'storage';
		description: string;
	}

	let params = $state<SupplyParam[]>([]);
	let loadError = $state<string | null>(null);

	function slug(name: string): string {
		return name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '');
	}

	function parseSupplyCsv(text: string): SupplyParam[] {
		const lines = text
			.trim()
			.split(/\r?\n/)
			.map((l) => l.trim())
			.filter(Boolean);
		if (lines.length < 2) return [];

		const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
		const idx = (key: string) => header.indexOf(key);

		const iParam = idx('parameter');
		const iDefault = idx('default_mm');
		const iMin = idx('min_mm');
		const iMax = idx('max_mm');
		const iColor = idx('color');
		const iKind = idx('kind');
		const iDesc = idx('description');

		const out: SupplyParam[] = [];
		for (const line of lines.slice(1)) {
			const cols = line.split(',');
			const name = (cols[iParam] ?? '').trim();
			if (!name) continue;
			const mm = Number.parseFloat(cols[iDefault] ?? '0');
			const minMm = Number.parseFloat(cols[iMin] ?? '0');
			const maxMm = Number.parseFloat(cols[iMax] ?? '500');
			const kindRaw = (cols[iKind] ?? 'inflow').trim().toLowerCase();
			const kind: SupplyParam['kind'] =
				kindRaw === 'outflow' || kindRaw === 'storage' ? kindRaw : 'inflow';
			out.push({
				id: slug(name),
				name,
				mm: Number.isFinite(mm) ? mm : 0,
				minMm: Number.isFinite(minMm) ? minMm : 0,
				maxMm: Number.isFinite(maxMm) ? maxMm : 500,
				color: (cols[iColor] ?? '#94a3b8').trim() || '#94a3b8',
				kind,
				description: (cols[iDesc] ?? '').trim()
			});
		}
		return out;
	}

	onMount(async () => {
		try {
			const res = await fetch('/water_supply.csv');
			if (!res.ok) throw new Error('Could not load water_supply.csv');
			const text = await res.text();
			const rows = parseSupplyCsv(text);
			if (rows.length === 0) throw new Error('water_supply.csv has no parameters.');
			params = rows;
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Failed to load supply data.';
		}
	});

	let totalMm = $derived(params.reduce((s, p) => s + p.mm, 0));
	let inflowMm = $derived(params.filter((p) => p.kind === 'inflow').reduce((s, p) => s + p.mm, 0));
	let outflowMm = $derived(params.filter((p) => p.kind === 'outflow').reduce((s, p) => s + p.mm, 0));
	let storageMm = $derived(params.filter((p) => p.kind === 'storage').reduce((s, p) => s + p.mm, 0));
	let balanceMm = $derived(inflowMm - outflowMm);

	function fmt(n: number): string {
		return Number.isFinite(n) ? n.toLocaleString('en-IN', { maximumFractionDigits: 1 }) : '—';
	}

	function sharePct(mm: number): number {
		if (totalMm <= 0) return 0;
		return (mm / totalMm) * 100;
	}

	function setMm(id: string, raw: number) {
		params = params.map((p) => {
			if (p.id !== id) return p;
			const clamped = Math.max(p.minMm, Math.min(p.maxMm, Number.isFinite(raw) ? raw : 0));
			return { ...p, mm: Math.round(clamped * 10) / 10 };
		});
	}

	function resetDefaults() {
		// Reload from CSV defaults by re-fetching
		void (async () => {
			const res = await fetch('/water_supply.csv');
			if (!res.ok) return;
			params = parseSupplyCsv(await res.text());
		})();
	}

	let barEl = $state<HTMLElement | null>(null);
	interface ResizeState {
		idx: number;
		startX: number;
		startMm: number[];
		barWidth: number;
	}
	let resizing = $state<ResizeState | null>(null);

	function onDividerMouseDown(e: MouseEvent, idx: number) {
		if (!barEl || params.length < 2) return;
		e.preventDefault();
		resizing = {
			idx,
			startX: e.clientX,
			startMm: params.map((p) => p.mm),
			barWidth: barEl.getBoundingClientRect().width
		};
	}

	function onWindowMouseMove(e: MouseEvent) {
		if (!resizing || totalMm <= 0) return;
		const dShare = (e.clientX - resizing.startX) / resizing.barWidth;
		const left0 = resizing.startMm[resizing.idx];
		const right0 = resizing.startMm[resizing.idx + 1];
		const combined = left0 + right0;
		const deltaMm = dShare * (resizing.startMm.reduce((s, v) => s + v, 0));
		const leftParam = params[resizing.idx];
		const rightParam = params[resizing.idx + 1];
		let newLeft = left0 + deltaMm;
		newLeft = Math.max(leftParam.minMm, Math.min(combined - rightParam.minMm, newLeft));
		newLeft = Math.min(leftParam.maxMm, newLeft);
		let newRight = combined - newLeft;
		newRight = Math.max(rightParam.minMm, Math.min(rightParam.maxMm, newRight));
		newLeft = combined - newRight;
		params = params.map((p, i) => {
			if (i === resizing!.idx) return { ...p, mm: Math.round(newLeft * 10) / 10 };
			if (i === resizing!.idx + 1) return { ...p, mm: Math.round(newRight * 10) / 10 };
			return p;
		});
	}

	function onWindowMouseUp() {
		resizing = null;
	}

	function cumulativeShare(upToIdx: number): number {
		let sum = 0;
		for (let i = 0; i <= upToIdx; i++) sum += sharePct(params[i].mm);
		return sum;
	}
</script>

<svelte:window onmousemove={onWindowMouseMove} onmouseup={onWindowMouseUp} />

<div class="min-h-screen bg-slate-50">
	<div class="border-b border-slate-200 bg-white px-6 py-5">
		<div class="mx-auto max-w-7xl">
			<div class="flex flex-wrap items-end justify-between gap-4">
				<div>
					<h1 class="text-2xl font-semibold text-slate-900">Supply Calculator</h1>
					<p class="mt-0.5 text-sm text-slate-500">
						Adjust rainfall, canal, groundwater, ET, and soil moisture (all in mm) on a stacked
						supply bar.
					</p>
				</div>
				<button
					type="button"
					onclick={resetDefaults}
					class="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
				>
					Reset to CSV defaults
				</button>
			</div>
		</div>
	</div>

	<div class="mx-auto max-w-7xl px-6 py-6">
		{#if loadError}
			<div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
				{loadError}
			</div>
		{:else if params.length === 0}
			<p class="text-sm text-slate-500">Loading supply parameters…</p>
		{:else}
			<div class="flex gap-6">
				<aside class="w-52 shrink-0">
					<h2 class="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
						Parameters
					</h2>
					<p class="mb-3 text-xs leading-relaxed text-slate-400">
						All five are selected by default. Values are millimetres (mm).
					</p>
					<div class="space-y-1.5">
						{#each params as p}
							<div
								class="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2"
							>
								<span
									class="h-2.5 w-2.5 shrink-0 rounded-full"
									style="background-color: {p.color}"
								></span>
								<div class="min-w-0 flex-1">
									<div class="truncate text-xs font-medium text-slate-800">{p.name}</div>
									<div class="text-xs capitalize text-slate-400">{p.kind} · {fmt(p.mm)} mm</div>
								</div>
								<svg class="h-3 w-3 shrink-0 text-emerald-500" viewBox="0 0 20 20" fill="currentColor">
									<path
										fill-rule="evenodd"
										d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
										clip-rule="evenodd"
									/>
								</svg>
							</div>
						{/each}
					</div>
				</aside>

				<div class="min-w-0 flex-1">
					<div class="mb-2 flex items-center justify-between">
						<div class="flex items-center gap-2">
							<span class="text-sm font-medium text-slate-700">Supply Bar</span>
							<span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
								{fmt(totalMm)} mm total
							</span>
						</div>
					</div>

					<div
						bind:this={barEl}
						role="region"
						aria-label="Water supply stacked bar"
						class="relative flex h-20 w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-100"
					>
						{#each params as p, i}
							{@const pct = sharePct(p.mm)}
							<div
								class="relative flex h-full shrink-0 items-center justify-center overflow-hidden"
								style="width: {pct}%; background-color: {p.color}; transition: width {resizing
									? '0ms'
									: '120ms'} ease;"
								title="{p.name}: {fmt(p.mm)} mm"
							>
								{#if pct > 8}
									<div class="pointer-events-none select-none text-center">
										<div class="truncate px-1 text-xs font-semibold leading-tight text-white/95">
											{p.name.replace('Evapotranspiration (ET)', 'ET')}
										</div>
										<div class="text-xs text-white/75">{fmt(p.mm)} mm</div>
									</div>
								{/if}
							</div>
							{#if i < params.length - 1}
								<div
									role="separator"
									aria-label="Resize handle"
									class="absolute top-0 z-10 h-full w-2 cursor-col-resize hover:bg-white/20"
									style="left: calc({cumulativeShare(i)}% - 4px)"
									onmousedown={(e) => onDividerMouseDown(e, i)}
								>
									<div
										class="absolute left-1/2 top-2 h-[calc(100%-1rem)] w-0.5 -translate-x-1/2 rounded-full bg-white/50"
									></div>
								</div>
							{/if}
						{/each}
					</div>
					<p class="mt-1.5 text-xs text-slate-400">
						Segment width is proportional to each parameter’s mm value. Drag dividers to trade depth
						between neighbours, or use the sliders below.
					</p>

					<div class="mt-5 space-y-3">
						{#each params as p}
							{@const pct = sharePct(p.mm)}
							<div class="rounded-xl border border-slate-200 bg-white px-4 py-3">
								<div class="mb-2 flex flex-wrap items-center gap-3">
									<span
										class="h-4 w-4 shrink-0 rounded-full"
										style="background-color: {p.color}"
									></span>
									<div class="min-w-0 flex-1">
										<div class="text-sm font-medium text-slate-900">{p.name}</div>
										<div class="text-xs capitalize text-slate-400">
											{p.kind}{#if p.description}
												· {p.description}{/if}
										</div>
									</div>
									<div class="flex items-center gap-1.5">
										<input
											type="number"
											min={p.minMm}
											max={p.maxMm}
											step="1"
											value={p.mm}
											oninput={(e) =>
												setMm(p.id, parseFloat((e.target as HTMLInputElement).value))}
											class="w-20 rounded-md border border-slate-300 px-2 py-1 text-center text-sm font-medium focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
										/>
										<span class="text-sm text-slate-400">mm</span>
									</div>
									<div class="w-16 text-right text-xs text-slate-400">{pct.toFixed(1)}%</div>
								</div>
								<input
									type="range"
									min={p.minMm}
									max={p.maxMm}
									step="1"
									value={p.mm}
									oninput={(e) => setMm(p.id, parseFloat((e.target as HTMLInputElement).value))}
									class="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-blue-600"
									style="accent-color: {p.color}"
									aria-label="{p.name} in millimetres"
								/>
								<div class="mt-1 flex justify-between text-[10px] text-slate-400">
									<span>{p.minMm} mm</span>
									<span>{p.maxMm} mm</span>
								</div>
							</div>
						{/each}
					</div>

					<div class="mt-3 rounded-xl border border-slate-200 bg-white px-5 py-4">
						<div class="flex flex-wrap items-center justify-between gap-4">
							<div>
								<div class="text-sm font-semibold text-slate-900">Balance snapshot</div>
								<div class="mt-0.5 text-xs text-slate-400">
									Inflows − ET · soil moisture shown separately as storage
								</div>
							</div>
							<div class="flex flex-wrap gap-6">
								<div class="text-right">
									<div class="text-lg font-bold text-sky-600">{fmt(inflowMm)} mm</div>
									<div class="text-xs text-slate-400">inflows</div>
								</div>
								<div class="text-right">
									<div class="text-lg font-bold text-orange-600">{fmt(outflowMm)} mm</div>
									<div class="text-xs text-slate-400">ET</div>
								</div>
								<div class="text-right">
									<div class="text-lg font-bold text-teal-600">{fmt(storageMm)} mm</div>
									<div class="text-xs text-slate-400">soil moisture</div>
								</div>
								<div class="text-right">
									<div
										class="text-lg font-bold {balanceMm >= 0 ? 'text-emerald-600' : 'text-red-600'}"
									>
										{fmt(balanceMm)} mm
									</div>
									<div class="text-xs text-slate-400">inflow − ET</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>
