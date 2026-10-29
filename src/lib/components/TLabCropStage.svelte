<script lang="ts">
	import { cropColor, formatDate, type AgriFeature } from '$lib/tlab';
	import { fmtHa } from '$lib/tlabCrops.svelte';
	import { STAGE_BY_ID, cellStages } from '$lib/tlabStage';

	interface Props {
		features: AgriFeature[];
		seasonKey: string | null;
		cellToken: string | null;
	}

	let { features, seasonKey, cellToken }: Props = $props();

	const now = Date.now() / 1000;
	const info = $derived(cellStages(features, seasonKey, now));
	const growing = $derived(info.stages.some((s) => s.stage !== 'harvested' && s.stage !== 'none'));
	const refresh = $derived(info.ctx.latestEnd ? formatDate(info.ctx.latestEnd) : null);

	function pct(ha: number): string {
		return info.farmHa > 0 ? `${((ha / info.farmHa) * 100).toFixed(0)}%` : '0%';
	}

	const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	const GROWTH: { id: 'establishment' | 'vegetative' | 'flowering' | 'maturity'; from: number; to: number }[] = [
		{ id: 'establishment', from: 0, to: 0.15 },
		{ id: 'vegetative', from: 0.15, to: 0.45 },
		{ id: 'flowering', from: 0.45, to: 0.75 },
		{ id: 'maturity', from: 0.75, to: 1 }
	];
	const TOP = 6;
	const LABEL_W = 88;
	const HEAD = 20;
	const ROW = 26;
	const BAR_H = 11;

	let boxW = $state(320);
	const W = $derived(Math.max(300, Math.round(boxW)));

	const timeline = $derived.by(() => {
		const rows = info.crops.filter((c) => c.sowingSec != null && (c.expectedEndSec ?? c.endSec) != null).slice(0, TOP);
		if (!rows.length) return null;
		let lo = Infinity;
		let hi = -Infinity;
		for (const c of rows) {
			lo = Math.min(lo, c.sowFrom ?? c.sowingSec!);
			hi = Math.max(hi, c.expectedEndSec ?? c.endSec!, c.ongoing ? now : -Infinity);
		}
		const first = new Date(lo * 1000);
		const start = new Date(first.getFullYear(), first.getMonth(), 1);
		const last = new Date(hi * 1000);
		const end = new Date(last.getFullYear(), last.getMonth() + 1, 1);
		const t0 = start.getTime() / 1000;
		const t1 = end.getTime() / 1000;
		const x = (sec: number) => LABEL_W + ((sec - t0) / (t1 - t0)) * (W - LABEL_W - 4);
		const months: { x: number; w: number; label: string; year: string | null }[] = [];
		for (let d = new Date(start); d < end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
			const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
			const mx = x(d.getTime() / 1000);
			months.push({
				x: mx,
				w: x(next.getTime() / 1000) - mx,
				label: MONTHS[d.getMonth()],
				year: d.getMonth() === 0 || months.length === 0 ? String(d.getFullYear()) : null
			});
		}
		const bars = rows.map((c, i) => {
			const sow = c.sowingSec!;
			const harvest = c.expectedEndSec ?? c.endSec!;
			const span = harvest - sow;
			return {
				c,
				y: HEAD + i * ROW,
				x0: x(sow),
				x1: x(harvest),
				wFrom: x(c.sowFrom ?? sow),
				wTo: x(c.sowTo ?? sow),
				segments: GROWTH.map((g) => ({ id: g.id, x: x(sow + span * g.from), w: x(sow + span * g.to) - x(sow + span * g.from) })),
				grown: c.ongoing ? Math.min(Math.max(x(now), x(sow)), x(harvest)) : x(harvest),
				title:
					`${c.label}: sown ${formatDate(sow)}` +
					(c.sowFrom && c.sowTo ? ` (most between ${formatDate(c.sowFrom)} and ${formatDate(c.sowTo)})` : '') +
					`, ${c.ongoing ? 'expected harvest' : 'harvested'} ${formatDate(harvest)}`
			};
		});
		const todayX = now >= t0 && now <= t1 ? x(now) : null;
		return { months, bars, todayX, height: HEAD + rows.length * ROW + 14 };
	});
</script>

<section class="stage" aria-label="Crop stage in the selected cell">
	<h3>Crop stage · Cell {cellToken ?? '—'}</h3>
	<p class="muted">
		{seasonKey ?? 'No season'} · Google AMED{#if growing}, as of {formatDate(now)}{/if}
		{#if refresh}<br />Latest AMED window ends {refresh}{/if}
	</p>

	{#if !info.stages.length}
		<p class="muted">No farm plots in this cell.</p>
	{:else}
		<div class="bar" aria-hidden="true">
			{#each info.stages as s (s.stage)}
				{#if s.ha > 0}<span style:flex-grow={s.ha} style:background={STAGE_BY_ID[s.stage].color}></span>{/if}
			{/each}
		</div>
		<ul class="stages">
			{#each info.stages as s (s.stage)}
				<li>
					<span class="chip" style:background={STAGE_BY_ID[s.stage].color}></span>
					<span class="name">{STAGE_BY_ID[s.stage].label}</span>
					<span class="n">{fmtHa(s.ha)} ha · {pct(s.ha)}</span>
					<span class="n">{s.plots.toLocaleString('en-IN')} plots</span>
				</li>
			{/each}
		</ul>

		{#if timeline}
			<h4>Sowing to harvest</h4>
			<div class="tlbox" bind:clientWidth={boxW}>
				<svg
					class="timeline"
					width={W}
					height={timeline.height}
					viewBox="0 0 {W} {timeline.height}"
					role="img"
					aria-label="Season months from sowing to harvest for each crop"
				>
					{#each timeline.months as m, i (i)}
						<rect x={m.x} y={HEAD - 3} width={m.w} height={timeline.height - HEAD - 9} fill={i % 2 ? '#ffffff' : '#eef2f7'} />
						<text x={m.x + m.w / 2} y="12" class="mlabel" text-anchor="middle">{m.w < 26 ? m.label[0] : m.label}</text>
						{#if m.year}<text x={m.x + 2} y={timeline.height - 1} class="ylabel">{m.year}</text>{/if}
					{/each}
					{#each timeline.bars as b (b.c.crop)}
						{@const mid = b.y + ROW / 2}
						<g>
							<title>{b.title}</title>
							<circle cx="6" cy={mid} r="4" fill={cropColor(b.c.crop)} />
							<text x="15" y={mid + 4} class="clabel">{b.c.label.length > 11 ? `${b.c.label.slice(0, 10)}…` : b.c.label}</text>
							<line x1={b.wFrom} x2={b.wTo} y1={mid} y2={mid} stroke="#00296b66" stroke-width="1.2" />
							<line x1={b.wFrom} x2={b.wFrom} y1={mid - 4} y2={mid + 4} stroke="#00296b66" stroke-width="1.2" />
							<line x1={b.wTo} x2={b.wTo} y1={mid - 4} y2={mid + 4} stroke="#00296b66" stroke-width="1.2" />
							{#each b.segments as s (s.id)}
								<rect
									x={s.x}
									y={mid - BAR_H / 2}
									width={Math.max(0, s.w)}
									height={BAR_H}
									fill={STAGE_BY_ID[s.id].color}
									opacity={b.c.ongoing && s.x >= b.grown ? 0.3 : 1}
								/>
							{/each}
							{#if b.c.ongoing && b.grown < b.x1}
								<rect
									x={b.grown}
									y={mid - BAR_H / 2}
									width={b.x1 - b.grown}
									height={BAR_H}
									fill="none"
									stroke="#00296b77"
									stroke-dasharray="3 2"
								/>
							{/if}
							<rect
								x={b.x0}
								y={mid - BAR_H / 2}
								width={Math.max(1, b.x1 - b.x0)}
								height={BAR_H}
								rx="2"
								fill="none"
								stroke="#00296b40"
								stroke-width="0.8"
							/>
						</g>
					{/each}
					{#if timeline.todayX != null}
						<line
							x1={timeline.todayX}
							x2={timeline.todayX}
							y1={HEAD - 3}
							y2={timeline.height - 12}
							stroke="#e11d48"
							stroke-width="1.5"
						/>
						<text x={timeline.todayX} y={timeline.height - 1} class="today" text-anchor="middle">today</text>
					{/if}
				</svg>
			</div>
			<div class="key">
				{#each GROWTH as g (g.id)}<span><i style:background={STAGE_BY_ID[g.id].color}></i>{STAGE_BY_ID[g.id].label}</span>{/each}
				<span><i class="whisker"></i>Sowing spread</span>
				{#if timeline.bars.some((b) => b.c.ongoing)}<span><i class="ahead"></i>Expected</span>{/if}
			</div>
		{/if}

		{#if info.crops.length}
			<table>
				<thead>
					<tr><th>Crop</th><th>Sown</th><th>Stage</th><th class="num">ha</th></tr>
				</thead>
				<tbody>
					{#each info.crops as c (c.crop)}
						<tr>
							<td><span class="chip" style:background={cropColor(c.crop)}></span>{c.label}</td>
							<td>{c.sowingSec ? formatDate(c.sowingSec) : '—'}</td>
							<td>
								<span class="chip sm" style:background={STAGE_BY_ID[c.stage].color}></span>{STAGE_BY_ID[c.stage].label}
								{#if c.day != null}
									<small>{c.ongoing ? `day ${c.day} of ~${c.typicalDays}` : `${c.day}-day season`}</small>
								{/if}
							</td>
							<td class="num">{fmtHa(c.ha)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}

		<p class="muted note">
			AMED gives each plot a sowing date and a harvest date, refreshed every 15 days. A season still in the field
			ends at the latest refresh, so its stage is days since sowing against the crop's typical season length here
			(median of this cell's past seasons): Establishment &lt;15%, Vegetative 15–45%, Flowering 45–75%, Maturity
			75–100%. Sown and day are plot medians; stage is the one covering most area. Timeline bars run from median
			sowing to median harvest (or sowing + typical length while still in the field), split into those stages.
		</p>
	{/if}
</section>

<style>
	.stage {
		padding: 0.9rem 1rem;
		border-bottom: 1px solid #00296b0d;
		background: #f8fafc;
	}

	h3 {
		margin: 0 0 0.25rem;
		font-size: 0.85rem;
		font-weight: 700;
	}

	.muted {
		margin: 0 0 0.6rem;
		font-size: 0.72rem;
		color: #00296b99;
	}

	.note {
		margin: 0.6rem 0 0;
	}

	.bar {
		display: flex;
		height: 0.75rem;
		border-radius: 3px;
		overflow: hidden;
		margin-bottom: 0.5rem;
	}

	.stages {
		list-style: none;
		margin: 0 0 0.6rem;
		padding: 0;
		font-size: 0.74rem;
	}

	.stages li {
		display: grid;
		grid-template-columns: auto 1fr auto auto;
		align-items: center;
		gap: 0.4rem;
		padding: 0.15rem 0;
	}

	.stages .n {
		font-variant-numeric: tabular-nums;
		color: #00296b99;
	}

	.chip {
		display: inline-block;
		width: 0.65rem;
		height: 0.65rem;
		margin-right: 0.3rem;
		border-radius: 0.15rem;
		vertical-align: baseline;
	}

	.stages .chip {
		margin-right: 0;
	}

	.chip.sm {
		width: 0.55rem;
		height: 0.55rem;
	}

	h4 {
		margin: 0.4rem 0 0.3rem;
		font-size: 0.76rem;
		font-weight: 700;
	}

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

	.timeline .ylabel {
		font-size: 10px;
		fill: #00296b80;
	}

	.timeline .clabel {
		font-size: 11.5px;
		fill: #00296b;
	}

	.timeline .today {
		font-size: 10px;
		fill: #e11d48;
		font-weight: 600;
	}

	.key {
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem 0.75rem;
		margin: 0.4rem 0 0.8rem;
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

	.key i.whisker {
		height: 0;
		border-top: 1px solid #00296b88;
		vertical-align: middle;
	}

	.key i.ahead {
		border: 1px dashed #00296b88;
		background: #ffffff;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.72rem;
	}

	th,
	td {
		text-align: left;
		vertical-align: top;
		padding: 0.25rem 0.3rem 0.25rem 0;
		border-bottom: 1px solid #00296b0d;
	}

	th {
		font-weight: 600;
		color: #00296b99;
	}

	td small {
		display: block;
		color: #00296b99;
	}

	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
</style>
