<script lang="ts" module>
	export interface SeasonSegment {
		color: string;
		value: number;
	}

	export interface SeasonColumn {
		key: string;
		/** Label under the column, e.g. K, R, S or a year */
		short: string;
		/** Columns sharing a group sit together under one label, e.g. an agricultural year */
		group?: string;
		total: number;
		/** Stacked bottom-up, in the order given */
		segments: SeasonSegment[];
		title: string;
	}

	const ORDER: Record<string, number> = { Kharif: 0, Rabi: 1, Summer: 2, Zaid: 2 };

	/**
	 * Short label and agricultural-year group for a season key ("Kharif 2025", "Rabi 2025–26",
	 * "Summer 2026"). Summer belongs to the year whose Kharif came before it.
	 */
	export function seasonSlot(key: string): { short: string; group: string; order: number } {
		const [season = '', label = ''] = key.split(' ');
		const y = Number(label.slice(0, 4));
		if (!Number.isFinite(y) || !y) return { short: season.slice(0, 1), group: label, order: ORDER[season] ?? 3 };
		const ag = season === 'Summer' || season === 'Zaid' ? y - 1 : y;
		return {
			short: season.slice(0, 1),
			group: `${ag}–${String((ag + 1) % 100).padStart(2, '0')}`,
			order: ORDER[season] ?? 3
		};
	}

	/** Sort columns by agricultural year, then Kharif, Rabi, Summer */
	export function sortSeasonColumns<T extends { key: string }>(cols: T[]): T[] {
		const rank = (k: string) => {
			const s = seasonSlot(k);
			return Number(s.group.slice(0, 4)) * 10 + s.order;
		};
		return [...cols].sort((a, b) => rank(a.key) - rank(b.key));
	}
</script>

<script lang="ts">
	interface Props {
		columns: SeasonColumn[];
		selected?: string | null;
		onSelect?: (key: string) => void;
		format: (v: number) => string;
		unit?: string;
		legend?: { color: string; label: string }[];
		label?: string;
	}

	let { columns, selected = null, onSelect, format, unit = '', legend = [], label = 'Values by season' }: Props =
		$props();

	const max = $derived(Math.max(1e-9, ...columns.map((c) => c.total)));
	/** Plot height in px; every segment gets an explicit height so no browser collapses it */
	const H = 144;
	function px(v: number): number {
		return (Math.max(0, v) / max) * H;
	}

	const groups = $derived.by(() => {
		const out: { group: string; cols: SeasonColumn[] }[] = [];
		for (const c of columns) {
			const g = c.group ?? '';
			const last = out[out.length - 1];
			if (last && last.group === g && g) last.cols.push(c);
			else out.push({ group: g, cols: [c] });
		}
		return out;
	});
	const grouped = $derived(columns.some((c) => c.group));

	function groupLabel(g: { group: string; cols: SeasonColumn[] }): string {
		if (g.cols.length > 1 || g.group.length <= 3) return g.group;
		// A lone column has no room for "2017–18"
		return `’${g.group.slice(2, 4)}`;
	}
</script>

{#if columns.length}
	<div class="chart" role="group" aria-label={label}>
		<div class="axis" aria-hidden="true">
			<span>{format(max)}{unit ? ` ${unit}` : ''}</span>
			<span>{format(max / 2)}</span>
			<span>0</span>
		</div>
		<div class="plot">
			{#each groups as g, gi (gi)}
				<div class="grp" style:--n={g.cols.length}>
					<div class="cols">
						{#each g.cols as c (c.key)}
							<button
								type="button"
								class="col"
								class:on={c.key === selected}
								disabled={!onSelect}
								onclick={() => onSelect?.(c.key)}
								title={c.title}
							>
								<span class="well">
									{#if c.total > 0}
										{@const segSum = c.segments.reduce((x, sg) => x + Math.max(0, sg.value), 0)}
										{@const h = Math.max(2, px(c.total))}
										<span class="stack" style:height="{h}px">
											{#each c.segments as sg, si (si)}
												{#if sg.value > 0}<span
														class="seg"
														style:height="{segSum > 0 ? (sg.value / segSum) * h : 0}px"
														style:background={sg.color}
													></span>{/if}
											{/each}
										</span>
									{/if}
								</span>
								<span class="short">{c.short}</span>
							</button>
						{/each}
					</div>
					{#if grouped}<span class="glabel" title={g.group}>{groupLabel(g)}</span>{/if}
				</div>
			{/each}
		</div>
	</div>
	{#if legend.length}
		<div class="key">
			{#each legend as l (l.label)}<span><i style:background={l.color}></i>{l.label}</span>{/each}
		</div>
	{/if}
{/if}

<style>
	.chart {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.35rem;
		margin-top: 0.4rem;
	}

	.axis {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		height: 144px;
		font-size: 0.62rem;
		line-height: 1;
		color: #00296b99;
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.plot {
		display: flex;
		gap: 0.35rem;
		min-width: 0;
		border-left: 1px solid #00296b33;
		padding-left: 0.35rem;
	}

	.grp {
		display: flex;
		flex-direction: column;
		flex: var(--n, 1) 1 0;
		min-width: 0;
	}

	.cols {
		display: flex;
		gap: 2px;
	}

	.col {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		flex: 1 1 0;
		min-width: 0;
		max-width: 2.6rem;
		margin: 0 auto;
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}

	.col:disabled {
		cursor: default;
	}

	.well {
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		height: 144px;
		border-bottom: 1px solid #00296b33;
	}

	.stack {
		display: flex;
		flex-direction: column-reverse;
		flex: none;
		width: 100%;
		border-radius: 2px 2px 0 0;
		overflow: hidden;
		background: #e2e8f0;
	}

	.seg {
		display: block;
		flex: none;
		width: 100%;
	}

	.col:not(:disabled):hover .stack {
		filter: brightness(1.08);
	}

	.col.on .stack {
		outline: 1.5px solid #e11d48;
		outline-offset: 1px;
	}

	.short {
		font-size: 0.62rem;
		line-height: 1.1rem;
		text-align: center;
		color: #00296b99;
		white-space: nowrap;
		overflow: hidden;
	}

	.col.on .short {
		font-weight: 700;
		color: #e11d48;
	}

	.glabel {
		font-size: 0.66rem;
		font-weight: 600;
		text-align: center;
		white-space: nowrap;
		overflow: hidden;
	}

	.key {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.6rem;
		margin-top: 0.6rem;
		font-size: 0.65rem;
		color: #00296bcc;
	}

	.key i {
		display: inline-block;
		width: 0.55rem;
		height: 0.55rem;
		margin-right: 0.25rem;
		border-radius: 0.1rem;
	}
</style>
