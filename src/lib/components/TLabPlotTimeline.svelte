<script lang="ts">
	import { cropColor, formatCropLabel, formatDate, type MonitoringPrediction } from '$lib/tlab';
	import { STAGE_BY_ID, plotSeasons, type StageContext } from '$lib/tlabStage';

	interface Props {
		preds: MonitoringPrediction[] | undefined;
		ctx: StageContext | null;
		/** Season shown on the map, highlighted */
		seasonKey: string | null;
		onSeason?: (key: string) => void;
	}

	let { preds, ctx, seasonKey, onSeason }: Props = $props();

	const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	const GROWTH = [
		{ id: 'establishment', from: 0, to: 0.15 },
		{ id: 'vegetative', from: 0.15, to: 0.45 },
		{ id: 'flowering', from: 0.45, to: 0.75 },
		{ id: 'maturity', from: 0.75, to: 1 }
	] as const;
	/** Longest axis: the agricultural year from June, plus the next June–August for long crops */
	const AXIS_MONTHS = 15;
	const SHOW = 8;
	const LABEL_W = 108;
	const HEAD = 20;
	const ROW = 30;
	const BAR_H = 11;

	let boxW = $state(320);
	let showAll = $state(false);
	const W = $derived(Math.max(300, Math.round(boxW)));
	const now = Date.now() / 1000;

	const seasons = $derived(plotSeasons(preds, ctx, now));
	const shown = $derived(showAll ? seasons : seasons.slice(0, SHOW));

	/** June 1 of the agricultural year a date falls in */
	function agStart(sec: number): number {
		const d = new Date(sec * 1000);
		const y = d.getMonth() >= 5 ? d.getFullYear() : d.getFullYear() - 1;
		return new Date(y, 5, 1).getTime() / 1000;
	}

	/** Whole months since June 1 of the agricultural year, fractional */
	function monthOffset(sec: number, base: number): number {
		const d = new Date(sec * 1000);
		const b = new Date(base * 1000);
		const whole = (d.getFullYear() - b.getFullYear()) * 12 + d.getMonth() - b.getMonth();
		const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
		return whole + (d.getDate() - 1) / days;
	}

	const chart = $derived.by(() => {
		if (!shown.length) return null;
		let lo = Infinity;
		let hi = -Infinity;
		for (const s of shown) {
			const base = agStart(s.sowingSec!);
			lo = Math.min(lo, monthOffset(s.sowingSec!, base));
			hi = Math.max(hi, monthOffset(s.harvestSec, base), s.ongoing ? monthOffset(now, base) : -Infinity);
		}
		const first = Math.max(0, Math.floor(lo));
		const count = Math.min(AXIS_MONTHS - first, Math.max(4, Math.ceil(hi) - first));
		const plotW = W - LABEL_W - 6;
		const pos = (m: number) => LABEL_W + Math.min(1, Math.max(0, (m - first) / count)) * plotW;
		const months = Array.from({ length: count }, (_, i) => {
			const m = first + i;
			return { x: pos(m), w: pos(m + 1) - pos(m), label: MONTHS[(5 + m) % 12], wrap: m === 12 };
		});
		const rows = shown.map((s, i) => {
			const base = agStart(s.sowingSec!);
			const x = (sec: number) => pos(monthOffset(sec, base));
			const sow = s.sowingSec!;
			const length = s.harvestSec - sow;
			const y = HEAD + i * ROW;
			const grown = s.ongoing ? Math.min(Math.max(x(now), x(sow)), x(s.harvestSec)) : x(s.harvestSec);
			return {
				s,
				y,
				mid: y + ROW / 2,
				x0: x(sow),
				x1: x(s.harvestSec),
				clipped: monthOffset(s.harvestSec, base) > first + count,
				grown,
				todayX: s.ongoing ? x(now) : null,
				segments: GROWTH.map((g) => ({
					id: g.id,
					x: x(sow + length * g.from),
					w: x(sow + length * g.to) - x(sow + length * g.from)
				})),
				title:
					`${s.key} · ${formatCropLabel(s.crop)}: sown ${formatDate(sow)}, ` +
					(s.ongoing
						? `in the field (day ${s.day} of ~${s.typicalDays}), expected harvest ${formatDate(s.harvestSec)}`
						: `harvested ${formatDate(s.endSec ?? undefined)} after ${s.day} days`)
			};
		});
		return { months, rows, height: HEAD + rows.length * ROW + 6 };
	});

	const note = $derived(
		'Each row is one AMED season on the same June-to-May calendar, so years line up' +
			(chart?.months.some((m) => m.wrap) ? '; the dashed line marks the next June.' : '.') +
			(onSeason ? ' Click a row to show that season on the map.' : '')
	);
</script>

{#if chart}
	<div class="tlbox" bind:clientWidth={boxW}>
		<svg
			class="timeline"
			width={W}
			height={chart.height}
			viewBox="0 0 {W} {chart.height}"
			role="img"
			aria-label="Sowing to harvest for each season of this plot"
		>
			{#each chart.months as m, i (i)}
				<rect x={m.x} y={HEAD - 3} width={m.w} height={chart.height - HEAD - 3} fill={i % 2 ? '#ffffff' : '#eef2f7'} />
				{#if m.wrap}<line x1={m.x} x2={m.x} y1={HEAD - 3} y2={chart.height - 6} stroke="#00296b33" stroke-dasharray="2 2" />{/if}
				<text x={m.x + m.w / 2} y="12" class="mlabel" text-anchor="middle">{m.w < 22 ? m.label[0] : m.label}</text>
			{/each}
			{#each chart.rows as r (r.s.key + r.s.sowingSec)}
				<g
					class="row"
					class:on={r.s.key === seasonKey}
					role="button"
					tabindex="0"
					onclick={() => onSeason?.(r.s.key)}
					onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && onSeason?.(r.s.key)}
				>
					<title>{r.title}</title>
					<rect x="0" y={r.y + 1} width={W} height={ROW - 2} class="hit" rx="3" />
					<circle cx="6" cy={r.mid - 4} r="4" fill={cropColor(r.s.crop)} />
					<text x="15" y={r.mid - 1} class="clabel">{formatCropLabel(r.s.crop).slice(0, 13)}</text>
					<text x="15" y={r.mid + 10} class="slabel">{r.s.key}</text>
					{#each r.segments as g (g.id)}
						<rect
							x={g.x}
							y={r.mid - BAR_H / 2}
							width={Math.max(0, g.w)}
							height={BAR_H}
							fill={STAGE_BY_ID[g.id].color}
							opacity={r.s.ongoing && g.x >= r.grown ? 0.3 : 1}
						/>
					{/each}
					{#if r.s.ongoing && r.grown < r.x1}
						<rect
							x={r.grown}
							y={r.mid - BAR_H / 2}
							width={r.x1 - r.grown}
							height={BAR_H}
							fill="none"
							stroke="#00296b77"
							stroke-dasharray="3 2"
						/>
					{/if}
					<rect
						x={r.x0}
						y={r.mid - BAR_H / 2}
						width={Math.max(1, r.x1 - r.x0)}
						height={BAR_H}
						rx="2"
						fill="none"
						stroke="#00296b40"
						stroke-width="0.8"
					/>
					{#if r.clipped}<text x={W - 4} y={r.mid + 4} class="more" text-anchor="end">›</text>{/if}
					{#if r.todayX != null}
						<line x1={r.todayX} x2={r.todayX} y1={r.y + 3} y2={r.y + ROW - 3} stroke="#e11d48" stroke-width="1.5" />
					{/if}
				</g>
			{/each}
		</svg>
	</div>
	<div class="key">
		{#each GROWTH as g (g.id)}<span><i style:background={STAGE_BY_ID[g.id].color}></i>{STAGE_BY_ID[g.id].label}</span>{/each}
		{#if seasons.some((s) => s.ongoing)}
			<span><i class="ahead"></i>Expected</span>
			<span><i class="today"></i>Today</span>
		{/if}
	</div>
	<p class="note">
		{note}
		{#if seasons.length > SHOW}
			<button type="button" class="link" onclick={() => (showAll = !showAll)}>
				{showAll ? `Show latest ${SHOW}` : `Show all ${seasons.length} seasons`}
			</button>
		{/if}
	</p>
{:else}
	<p class="note">No AMED crop seasons for this plot.</p>
{/if}

<style>
	.tlbox {
		width: 100%;
		overflow-x: auto;
	}

	.timeline {
		display: block;
		font-family: 'Montserrat', sans-serif;
	}

	.timeline .mlabel {
		font-size: 11px;
		font-weight: 600;
		fill: #00296b99;
	}

	.timeline .clabel {
		font-size: 11.5px;
		font-weight: 600;
		fill: #00296b;
	}

	.timeline .slabel {
		font-size: 10px;
		fill: #00296b99;
	}

	.timeline .more {
		font-size: 13px;
		fill: #00296b99;
	}

	.timeline .hit {
		fill: transparent;
	}

	.timeline .row {
		cursor: pointer;
	}

	.timeline .row:hover .hit {
		fill: #00296b0a;
	}

	.timeline .row.on .hit {
		fill: #fde68a55;
		stroke: #f59e0b;
		stroke-width: 1;
	}

	.timeline .row:focus {
		outline: none;
	}

	.timeline .row:focus-visible .hit {
		stroke: #1b75e0;
		stroke-width: 1.5;
	}

	.key {
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem 0.75rem;
		margin: 0.4rem 0 0.3rem;
		font-size: 0.72rem;
		color: #00296bcc;
	}

	.key i {
		display: inline-block;
		width: 0.6rem;
		height: 0.5rem;
		margin-right: 0.25rem;
		border-radius: 1px;
		vertical-align: baseline;
	}

	.key i.ahead {
		border: 1px dashed #00296b88;
		background: #ffffff;
	}

	.key i.today {
		width: 0;
		height: 0.7rem;
		border-left: 2px solid #e11d48;
		border-radius: 0;
	}

	.note {
		margin: 0;
		font-size: 0.7rem;
		color: #00296b99;
	}

	.link {
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		font-weight: 600;
		color: #1b75e0;
		cursor: pointer;
	}
</style>
