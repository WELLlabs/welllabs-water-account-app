<script lang="ts" module>
	import { cropColor } from '$lib/tlab';

	export interface LineSeries {
		key: string;
		color: string;
		/** One value per column; null leaves a gap */
		values: (number | null)[];
	}

	/**
	 * The `n` crops with the largest score, one line each. `bySeason(key)` gives crop → value for a
	 * season; `score` ranks crops (default: the sum over all seasons).
	 */
	export function topCropSeries(
		keys: string[],
		bySeason: (key: string) => Map<string, number>,
		n = 5,
		score?: Map<string, number>
	): LineSeries[] {
		const cols = keys.map(bySeason);
		const totals = new Map<string, number>();
		for (const m of cols) for (const [crop, v] of m) if (v > 0) totals.set(crop, (totals.get(crop) ?? 0) + v);
		const rank = score ?? totals;
		return [...rank]
			.filter(([crop, v]) => v > 0 && totals.has(crop))
			.sort((a, b) => b[1] - a[1])
			.slice(0, n)
			.map(([crop]) => ({
				key: crop,
				color: cropColor(crop),
				values: cols.map((m) => {
					const v = m.get(crop);
					return v != null && v > 0 ? v : null;
				})
			}));
	}
</script>

<script lang="ts">
	interface Props {
		/** x-axis labels (agricultural years), in display order */
		keys: string[];
		series: LineSeries[];
		selected?: string | null;
		onSelect?: (key: string) => void;
		format: (v: number) => string;
		label: string;
		/** Treat missing values as zero rather than a gap */
		zeroFill?: boolean;
		/** One line above the chart: the leading crop and what changed */
		insight?: string;
	}

	let { keys, series, selected = null, onSelect, format, label, zeroFill = false, insight = '' }: Props = $props();

	const W = 480;
	const H = 150;
	const PAD = { l: 46, r: 14, t: 8, b: 20 };
	const iw = W - PAD.l - PAD.r;
	const ih = H - PAD.t - PAD.b;

	let hover = $state<number | null>(null);

	const max = $derived(Math.max(1e-9, ...series.flatMap((s) => s.values.map((v) => v ?? 0))));
	const x = (i: number) => PAD.l + (keys.length <= 1 ? iw / 2 : (i / (keys.length - 1)) * iw);
	const y = (v: number) => PAD.t + ih - (v / max) * ih;

	function path(values: (number | null)[]): string {
		let d = '';
		let pen = false;
		values.forEach((raw, i) => {
			const v = raw ?? (zeroFill ? 0 : null);
			if (v == null) {
				pen = false;
				return;
			}
			d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
			pen = true;
		});
		return d;
	}

	const sel = $derived(selected ? keys.indexOf(selected) : -1);
	const shown = $derived(hover ?? (sel >= 0 ? sel : null));

	function onKey(e: KeyboardEvent) {
		const at = shown ?? 0;
		if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
			e.preventDefault();
			hover = Math.min(keys.length - 1, Math.max(0, at + (e.key === 'ArrowLeft' ? -1 : 1)));
		} else if ((e.key === 'Enter' || e.key === ' ') && shown != null) {
			e.preventDefault();
			onSelect?.(keys[shown]);
		}
	}

	function onMove(e: PointerEvent) {
		const svg = e.currentTarget as SVGSVGElement;
		const r = svg.getBoundingClientRect();
		const px = ((e.clientX - r.left) / r.width) * W;
		let best = 0;
		for (let i = 1; i < keys.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
		hover = best;
	}
</script>

{#if keys.length && series.length}
	<figure class="lc">
		{#if insight}<p class="insight">{insight}</p>{/if}
		<svg
			viewBox="0 0 {W} {H}"
			role="slider"
			tabindex="0"
			aria-label="{label}. Arrow keys move between years, Enter shows one on the map."
			aria-valuemin={0}
			aria-valuemax={Math.max(0, keys.length - 1)}
			aria-valuenow={shown ?? 0}
			aria-valuetext={shown != null ? keys[shown] : undefined}
			onpointermove={onMove}
			onpointerleave={() => (hover = null)}
			onclick={() => hover != null && onSelect?.(keys[hover])}
			onkeydown={onKey}
			class:clickable={!!onSelect}
		>
			{#each [0, 0.5, 1] as f (f)}
				<line x1={PAD.l} x2={W - PAD.r} y1={y(max * f)} y2={y(max * f)} class="grid" />
				<text x={PAD.l - 5} y={y(max * f) + 3} class="tick" text-anchor="end">{format(max * f)}</text>
			{/each}
			{#if sel >= 0}<line x1={x(sel)} x2={x(sel)} y1={PAD.t} y2={PAD.t + ih} class="sel" />{/if}
			{#if hover != null && hover !== sel}<line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + ih} class="hov" />{/if}
			{#each series as s (s.key)}
				<path d={path(s.values)} stroke={s.color} class="line" />
				{#each s.values as v, i (i)}
					{#if v != null}<circle cx={x(i)} cy={y(v)} r={i === shown ? 3.2 : 1.8} fill={s.color} />{/if}
				{/each}
			{/each}
			{#each keys as k, i (k)}
				<text x={x(i)} y={PAD.t + ih + 13} class="tick" class:on={i === sel} text-anchor="middle"
					>{keys.length > 6 ? k.replace(/^20/, '’') : k}</text
				>
			{/each}
		</svg>
		<figcaption class="legend">
			{#each series as s (s.key)}
				{@const v = shown != null ? s.values[shown] : null}
				<span><i style:background={s.color}></i>{s.key}{#if shown != null}<b>{v != null ? format(v) : '—'}</b>{/if}</span>
			{/each}
			{#if shown != null}<span class="at">{keys[shown]}</span>{/if}
		</figcaption>
	</figure>
{/if}

<style>
	.lc {
		margin: 0.4rem 0 0;
	}

	.insight {
		margin: 0 0 0.35rem;
		padding: 0.35rem 0.5rem;
		border-left: 3px solid #1b75e0;
		background: #f1f6fd;
		font-size: 0.72rem;
		line-height: 1.45;
		color: #00296b;
	}

	svg {
		display: block;
		width: 100%;
		height: auto;
		overflow: visible;
		touch-action: pan-y;
	}

	svg.clickable {
		cursor: pointer;
	}

	.grid {
		stroke: #00296b1a;
		stroke-width: 1;
	}

	.sel {
		stroke: #e11d48;
		stroke-width: 1.2;
		stroke-dasharray: 3 2;
	}

	.hov {
		stroke: #00296b55;
		stroke-width: 1;
	}

	.line {
		fill: none;
		stroke-width: 2;
		stroke-linejoin: round;
		stroke-linecap: round;
	}

	.tick {
		font-size: 9px;
		fill: #00296b99;
		font-variant-numeric: tabular-nums;
	}

	.tick.on {
		fill: #e11d48;
		font-weight: 700;
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.7rem;
		margin-top: 0.35rem;
		font-size: 0.66rem;
		color: #00296bcc;
	}

	.legend i {
		display: inline-block;
		width: 0.7rem;
		height: 0.18rem;
		margin-right: 0.3rem;
		vertical-align: middle;
		border-radius: 1px;
	}

	.legend b {
		margin-left: 0.25rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.legend .at {
		margin-left: auto;
		color: #00296b99;
	}
</style>
