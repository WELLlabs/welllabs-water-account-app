<script lang="ts">
	import {
		cropColor,
		formatCropLabel,
		formatDate,
		formatPct,
		UNCERTAIN_COLOR,
		type SeasonBar
	} from '$lib/tlab';

	interface Props {
		bars: SeasonBar[];
	}

	let { bars }: Props = $props();

	const W = 340;
	const ROW = 26;
	const M = { top: 4, right: 14, bottom: 22, left: 88 };
	const plotW = W - M.left - M.right;
	const ticks = [0, 0.25, 0.5, 0.75, 1];

	let hovered = $state<number | null>(null);

	const plotH = $derived(bars.length * ROW);
	const H = $derived(M.top + plotH + M.bottom);
	const barH = ROW * 0.7;

	// latest season on top
	const rows = $derived(
		bars
			.map((bar, idx) => {
				let acc = 0;
				const rects = [
					...bar.segments,
					...(bar.uncertain > 0.005 ? [{ crop: '', conf: bar.uncertain }] : [])
				].map((seg) => {
					const x = M.left + acc * plotW;
					const w = seg.conf * plotW;
					acc += seg.conf;
					return { ...seg, x, w };
				});
				return { idx, bar, rects };
			})
			.reverse()
			.map((row, i) => ({ ...row, y: M.top + i * ROW + (ROW - barH) / 2, rowY: M.top + i * ROW }))
	);

	const legend = $derived.by(() => {
		const totals = new Map<string, number>();
		for (const b of bars) for (const s of b.segments) totals.set(s.crop, (totals.get(s.crop) ?? 0) + s.conf);
		return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([crop]) => crop);
	});

	const detail = $derived(bars[hovered ?? bars.length - 1] ?? null);

	function tooltip(bar: SeasonBar, seg: { crop: string; conf: number }): string {
		const name = seg.crop ? formatCropLabel(seg.crop) : 'Other / uncertain';
		return `${bar.season} ${bar.year} · ${name} ${formatPct(seg.conf)}`;
	}
</script>

{#if bars.length}
	<div class="chart">
		<svg viewBox="0 0 {W} {H}" role="img" aria-label="Predicted crops by season">
			{#each ticks as t}
				{@const x = M.left + t * plotW}
				<line x1={x} x2={x} y1={M.top} y2={M.top + plotH} class="grid" />
				<text {x} y={M.top + plotH + 14} class="tick" text-anchor="middle">{Math.round(t * 100)}%</text>
			{/each}

			{#each rows as row (row.idx)}
				<g
					class="bar"
					class:dim={hovered != null && hovered !== row.idx}
					role="presentation"
					onmouseenter={() => (hovered = row.idx)}
					onmouseleave={() => (hovered = null)}
				>
					<rect x="0" y={row.rowY} width={W} height={ROW} fill="transparent" />
					<text x={M.left - 6} y={row.rowY + ROW / 2 + 3.5} class="ylab" text-anchor="end"
						>{row.bar.season} <tspan class="yyear">{row.bar.year}</tspan></text
					>
					{#each row.rects as r}
						<rect
							x={r.x}
							y={row.y}
							width={Math.max(0, r.w - 0.75)}
							height={barH}
							fill={r.crop ? cropColor(r.crop) : UNCERTAIN_COLOR}
						>
							<title>{tooltip(row.bar, r)}</title>
						</rect>
						{#if r.crop && r.w >= 28}
							<text x={r.x + r.w / 2} y={row.y + barH / 2 + 3.5} class="seg" text-anchor="middle"
								>{Math.round(r.conf * 100)}%</text
							>
						{/if}
					{/each}
				</g>
			{/each}
		</svg>

		<ul class="legend">
			{#each legend as crop}
				<li><span class="sw" style:background={cropColor(crop)}></span>{formatCropLabel(crop)}</li>
			{/each}
			{#if bars.some((b) => b.uncertain > 0.005)}
				<li><span class="sw" style:background={UNCERTAIN_COLOR}></span>Other / uncertain</li>
			{/if}
		</ul>

		{#if detail}
			<div class="detail">
				<div class="detail-head">
					<strong>{detail.season} {detail.year}</strong>
					<span>{formatDate(detail.startSec)} – {formatDate(detail.endSec)}</span>
				</div>
				{#each detail.segments as s}
					<div class="detail-row">
						<span class="sw" style:background={cropColor(s.crop)}></span>
						<span class="name">{formatCropLabel(s.crop)}</span>
						<span class="meter"><span style:width="{s.conf * 100}%" style:background={cropColor(s.crop)}></span></span>
						<span class="pct">{formatPct(s.conf)}</span>
					</div>
				{/each}
				{#if hovered == null}
					<div class="hint">Latest season shown — hover a bar for others</div>
				{/if}
			</div>
		{/if}
	</div>
{:else}
	<p class="empty">No crop history available for this feature.</p>
{/if}

<style>
	.chart svg {
		width: 100%;
		height: auto;
		display: block;
		font-family: 'Montserrat', sans-serif;
	}

	.grid {
		stroke: #00296b14;
		stroke-width: 1;
	}

	.tick {
		font-size: 10px;
		fill: #00296b99;
	}

	.ylab {
		font-size: 10.5px;
		font-weight: 600;
		fill: #00296b;
	}

	.yyear {
		font-weight: 400;
		fill: #00296b99;
	}

	.seg {
		font-size: 9.5px;
		font-weight: 600;
		fill: white;
		pointer-events: none;
	}

	.bar {
		cursor: default;
		transition: opacity 0.15s;
	}

	.bar.dim {
		opacity: 0.35;
	}

	.legend {
		list-style: none;
		margin: 0.5rem 0 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 0.75rem;
		font-size: 0.72rem;
	}

	.legend li {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}

	.sw {
		display: inline-block;
		width: 0.65rem;
		height: 0.65rem;
		border-radius: 0.15rem;
		flex-shrink: 0;
	}

	.detail {
		margin-top: 0.75rem;
		padding: 0.6rem 0.7rem;
		border-radius: 0.5rem;
		background: #f8fafc;
		border: 1px solid #00296b12;
		font-size: 0.76rem;
	}

	.detail-head {
		display: flex;
		flex-direction: column;
		margin-bottom: 0.45rem;
	}

	.detail-head span {
		font-size: 0.7rem;
		color: #00296b99;
	}

	.detail-row {
		display: grid;
		grid-template-columns: auto 5.5rem 1fr 2.4rem;
		align-items: center;
		gap: 0.4rem;
		padding: 0.15rem 0;
	}

	.meter {
		height: 0.4rem;
		border-radius: 999px;
		background: #00296b10;
		overflow: hidden;
	}

	.meter span {
		display: block;
		height: 100%;
	}

	.pct {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.hint {
		margin-top: 0.35rem;
		font-size: 0.68rem;
		color: #00296b80;
	}

	.empty {
		margin: 0;
		font-size: 0.8rem;
		color: #00296b99;
	}
</style>
