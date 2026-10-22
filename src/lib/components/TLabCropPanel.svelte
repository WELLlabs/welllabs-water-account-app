<script lang="ts">
	import { cropText, fmtHa, primaryKn, type CellRing, type CropArea, type TLabCrops } from '$lib/tlabCrops.svelte';

	interface Props {
		crops: TLabCrops;
		cellId: string | null;
		cellToken: string | null;
		plotId?: string | null;
		plotCodes?: string[];
		cellRing?: CellRing | null;
		onClearPlot?: () => void;
		onClose: () => void;
	}

	let { crops, cellId, cellToken, plotId = null, plotCodes = [], cellRing = null, onClearPlot, onClose }: Props = $props();

	const TOP = 8;

	const plot = $derived(plotId ? crops.plot(plotId) : null);
	const plotHistory = $derived(plotId ? crops.plotHistory(plotId) : []);

	const fromPlots = $derived(
		Boolean(cellId && cellRing && plotCodes.length && crops.plotsLoaded(plotCodes))
	);
	const areas = $derived(
		fromPlots ? crops.plotCellAreas(plotCodes, cellRing) : cellId ? crops.cell(cellId) : crops.district
	);
	const total = $derived(areas.reduce((s, a) => s + a.ha, 0));
	const cropped = $derived(areas.filter((a) => !a.group.idle).reduce((s, a) => s + a.ha, 0));
	const shown = $derived(areas.slice(0, cellId ? areas.length : 14));

	const history = $derived(fromPlots ? crops.plotCellHistory(plotCodes, cellRing) : crops.history(cellId));
	/** Groups in the history chart: the largest across all seasons, the rest as "Other" */
	const keyGroups = $derived.by(() => {
		const sums = new Map<number, { area: CropArea['group']; ha: number }>();
		const rows = plotId
			? plotHistory.map((h) => h.info?.areas ?? [])
			: history.map((h) => h.areas);
		for (const areas of rows)
			for (const a of areas) sums.set(a.group.id, { area: a.group, ha: (sums.get(a.group.id)?.ha ?? 0) + a.ha });
		return [...sums.values()].sort((a, b) => b.ha - a.ha).slice(0, TOP).map((s) => s.area);
	});
	const bars = $derived(
		history.map((h) => {
			const sum = h.areas.reduce((s, a) => s + a.ha, 0);
			const parts = keyGroups.map((g) => ({ g, ha: h.areas.find((a) => a.group.id === g.id)?.ha ?? 0 }));
			const other = sum - parts.reduce((s, p) => s + p.ha, 0);
			return { season: h.season, sum, parts, other };
		})
	);
	const maxSum = $derived(Math.max(1, ...bars.map((b) => b.sum)));

	const focusGroup = $derived(crops.focus != null ? crops.groups[crops.focus] : null);
	const villages = $derived(!cellId && !plotId && focusGroup ? crops.topVillages(focusGroup.id) : []);

	const plotYearBars = $derived.by(() => {
		const years = new Map<number, { year: number; sum: number; parts: { g: CropArea['group']; ha: number }[]; other: number }>();
		for (const h of plotHistory) {
			const areas = h.info?.areas ?? [];
			const sum = areas.reduce((s, a) => s + a.ha, 0);
			let row = years.get(h.season.year);
			if (!row) {
				row = { year: h.season.year, sum: 0, parts: keyGroups.map((g) => ({ g, ha: 0 })), other: 0 };
				years.set(h.season.year, row);
			}
			row.sum += sum;
			for (const a of areas) {
				const part = row.parts.find((p) => p.g.id === a.group.id);
				if (part) part.ha += a.ha;
				else row.other += a.ha;
			}
		}
		return [...years.values()].sort((a, b) => a.year - b.year);
	});
	const plotYearMax = $derived(Math.max(1, ...plotYearBars.map((b) => b.sum)));

	function toggleFocus(id: number) {
		crops.focus = crops.focus === id ? null : id;
	}
</script>

<aside class="panel" aria-label="Crop survey statistics">
	<header>
		<div class="title">
			<span class="sw" style:background="linear-gradient(135deg, #b45309, #db2777, #2563eb)"></span>
			<div>
				<h2>{plot ? 'Cadastral plot' : 'Crop survey'}</h2>
				<p class="meta">
					{#if plot}
						{plot.villageName} · Sy. {plot.label}
						<small>{fmtHa(plot.areaHa)} ha cadastral{plot.category ? ` · ${plot.category}` : ''}</small>
					{:else}
						{cellId ? `Cell ${cellToken ?? '—'}` : 'Raichur district'} · {crops.season?.label ?? '—'}
						<small>Karnataka crop survey, area recorded per survey number</small>
					{/if}
				</p>
			</div>
		</div>
		<button type="button" class="close" onclick={onClose} aria-label="Close crop survey statistics">×</button>
	</header>

	{#if plot}
		<section>
			<dl class="facts">
				<div><dt>Survey number</dt><dd>{plot.survey || '—'}</dd></div>
				<div><dt>Hissa / label</dt><dd>{plot.label}</dd></div>
				<div><dt>Cadastral area</dt><dd>{fmtHa(plot.areaHa)}<small class="inline"> ha</small></dd></div>
				<div><dt>Village</dt><dd>{plot.villageName}<small>{plot.village}</small></dd></div>
			</dl>
			{#if onClearPlot}
				<button type="button" class="back" onclick={onClearPlot}>‹ Cell summary</button>
			{/if}
		</section>

		<section>
			<h3>{crops.season?.label ?? 'This season'}</h3>
			{#if plot.category}
				<p class="muted">{plot.category}</p>
			{:else if !plot.areas.length}
				<p class="muted">No crop survey record for this parcel in {crops.season?.label ?? 'this season'}.</p>
			{:else}
				{#if plot.from === 'survey'}<p class="muted">Whole survey number; this parcel's hissa has no separate record.</p>{/if}
				<table>
					<thead><tr><th>Crop</th><th class="num">ha</th><th class="num">Share</th><th></th></tr></thead>
					<tbody>
						{#each plot.areas as a (a.group.name)}
							<tr>
								<td><span class="chip" style:background={a.group.color}></span>{cropText(a.group)}</td>
								<td class="num">{a.ha.toFixed(2)}</td>
								<td class="num">{((a.ha / plot.areas.reduce((s, x) => s + x.ha, 0)) * 100).toFixed(0)}%</td>
								<td class="barcell"><span style:width="{(a.ha / plot.areas[0].ha) * 100}%" style:background={a.group.color}></span></td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</section>

		<section>
			<h3>Trend over the years</h3>
			<p class="muted">Surveyed crop area on this parcel (or its survey number). Click a year to show it on the map.</p>
			<div class="hist">
				{#each plotYearBars as b (b.year)}
					<button
						type="button"
						class="hrow"
						class:on={b.year === crops.season?.year}
						onclick={() => {
							const same = crops.seasons.find((s) => s.year === b.year && s.kind === crops.season?.kind);
							crops.seasonKey = (same ?? crops.seasons.find((s) => s.year === b.year))?.key ?? crops.seasonKey;
						}}
						title="{b.year}: {fmtHa(b.sum)} ha"
					>
						<span class="hlabel">{b.year}</span>
						<span class="hbar" style:width="{(b.sum / plotYearMax) * 100}%">
							{#each b.parts as p (p.g.id)}
								{#if p.ha > 0}<span style:flex-grow={p.ha} style:background={p.g.color}></span>{/if}
							{/each}
							{#if b.other > 0}<span style:flex-grow={b.other} style:background="#cbd5e1"></span>{/if}
						</span>
						<span class="hval">{fmtHa(b.sum)}</span>
					</button>
				{/each}
			</div>
			<div class="key">
				{#each keyGroups as g (g.id)}<span><i style:background={g.color}></i>{cropText(g)}</span>{/each}
				<span><i style:background="#cbd5e1"></i>Other</span>
			</div>
		</section>

		<section>
			<h3>Every season</h3>
			<div class="hist">
				{#each plotHistory as h (h.season.key)}
					<button
						type="button"
						class="hrow"
						class:on={h.season.key === crops.seasonKey}
						onclick={() => (crops.seasonKey = h.season.key)}
						title="{h.season.label}: {h.info?.areas.length ? h.info.areas.map((a) => `${cropText(a.group)} ${a.ha.toFixed(2)} ha`).join(', ') : 'no record'}"
					>
						<span class="hlabel">{h.season.label}</span>
						<span class="hbar" style:width="{Math.max(2, ((h.info?.areas.reduce((s, a) => s + a.ha, 0) ?? 0) / plotYearMax) * 100)}%">
							{#each h.info?.areas ?? [] as a (a.group.name)}
								<span style:flex-grow={a.ha} style:background={a.group.color}></span>
							{/each}
						</span>
						<span class="hval">{h.info?.areas.length ? fmtHa(h.info.areas.reduce((s, a) => s + a.ha, 0)) : '—'}</span>
					</button>
				{/each}
			</div>
		</section>
	{:else if !crops.season}
		<section><p class="muted">No season selected.</p></section>
	{:else}
		<section>
			<dl class="facts">
				<div><dt>Surveyed area</dt><dd>{fmtHa(total)}<small class="inline"> ha</small></dd></div>
				<div><dt>Under crops</dt><dd>{fmtHa(cropped)}<small class="inline"> ha</small></dd></div>
				{#if !cellId}
					<div>
						<dt>Villages with data</dt>
						<dd>{crops.season.villages.withData.toLocaleString('en-IN')}<small class="inline"> of {crops.season.villages.total}</small></dd>
					</div>
					<div>
						<dt>Survey numbers answered</dt>
						<dd>
							{crops.season.surveys.answered.toLocaleString('en-IN')}<small
								>of {crops.season.surveys.asked.toLocaleString('en-IN')} asked</small
							>
						</dd>
					</div>
				{/if}
			</dl>
			{#if crops.collecting}
				<p class="muted note">
					Still collecting this season: {crops.season.villages.scraped} of {crops.season.villages.total} villages
					so far.
				</p>
			{/if}
		</section>

		<section>
			<h3>{crops.season.label} by crop</h3>
			{#if !areas.length}
				<p class="muted">No survey records fall in this cell this season.</p>
			{:else}
				<p class="muted">{cellId ? '' : 'Click a crop to map its area per cell.'}</p>
				<table>
					<thead><tr><th>Crop</th><th class="num">ha</th><th class="num">Share</th><th></th></tr></thead>
					<tbody>
						{#each shown as a (a.group.id)}
							{@const kn = primaryKn(a.group)}
							<tr class:sel={crops.focus === a.group.id}>
								<td>
									<button type="button" class="crop" onclick={() => toggleFocus(a.group.id)} title={a.group.kn.join(', ') || a.group.name}>
										<span class="chip" style:background={a.group.color}></span>
										{#if kn}
											<span class="kn">{kn}</span>
											<small class="en">{a.group.name}</small>
										{:else}
											{a.group.name}
										{/if}
									</button>
								</td>
								<td class="num">{fmtHa(a.ha)}</td>
								<td class="num">{((a.ha / total) * 100).toFixed(1)}%</td>
								<td class="barcell"><span style:width="{(a.ha / areas[0].ha) * 100}%" style:background={a.group.color}></span></td>
							</tr>
						{/each}
					</tbody>
				</table>
				{#if shown.length < areas.length}
					<p class="muted note">{areas.length - shown.length} smaller crops not listed.</p>
				{/if}
			{/if}
		</section>

		{#if villages.length}
			<section>
				<h3>Top villages · {focusGroup ? cropText(focusGroup) : ''}</h3>
				<table>
					<tbody>
						{#each villages as v (v.code)}
							<tr><td>{v.name}</td><td class="num">{fmtHa(v.ha)} ha</td></tr>
						{/each}
					</tbody>
				</table>
			</section>
		{/if}

		<section>
			<h3>Every season</h3>
			<p class="muted">Area by crop per season; click a bar to show that season on the map.</p>
			<div class="hist">
				{#each bars as b (b.season.key)}
					<button
						type="button"
						class="hrow"
						class:on={b.season.key === crops.seasonKey}
						onclick={() => (crops.seasonKey = b.season.key)}
						title="{b.season.label}: {fmtHa(b.sum)} ha"
					>
						<span class="hlabel">{b.season.label}</span>
						<span class="hbar" style:width="{(b.sum / maxSum) * 100}%">
							{#each b.parts as p (p.g.id)}
								{#if p.ha > 0}<span style:flex-grow={p.ha} style:background={p.g.color}></span>{/if}
							{/each}
							{#if b.other > 0}<span style:flex-grow={b.other} style:background="#cbd5e1"></span>{/if}
						</span>
						<span class="hval">{fmtHa(b.sum)}</span>
					</button>
				{/each}
			</div>
			<div class="key">
				{#each keyGroups as g (g.id)}<span><i style:background={g.color}></i>{cropText(g)}</span>{/each}
				<span><i style:background="#cbd5e1"></i>Other</span>
			</div>
		</section>

		<section>
			<p class="muted">
				{#if cellId}
					Survey numbers are placed in a cell by where their KGIS cadastral parcels lie, so cell totals are
					approximate along cell edges.
				{/if}
				Areas are as recorded in the Raichur FRUITS scrape on S3 (acres-guntas, shown in hectares).
				Varieties are merged by crop. Owner names are not kept.
			</p>
		</section>
	{/if}
</aside>

<style>
	.panel {
		width: 23rem;
		flex-shrink: 0;
		overflow-y: auto;
		background: white;
		border-left: 1px solid color-mix(in srgb, #00296b 12%, white);
		font-family: 'Montserrat', sans-serif;
		color: #00296b;
	}

	header {
		position: sticky;
		top: 0;
		z-index: 1;
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 1rem 1rem 0.75rem;
		background: white;
		border-bottom: 1px solid #00296b12;
	}

	.title {
		display: flex;
		gap: 0.6rem;
		align-items: flex-start;
	}

	h2 {
		margin: 0;
		font-family: 'Josefin Sans', sans-serif;
		font-size: 1.2rem;
		font-weight: 700;
	}

	h3 {
		margin: 0 0 0.5rem;
		font-size: 0.85rem;
		font-weight: 700;
	}

	.meta {
		margin: 0.15rem 0 0;
		font-size: 0.75rem;
		color: #00296bcc;
	}

	.meta small {
		display: block;
		color: #00296b99;
	}

	.close {
		border: none;
		background: none;
		font-size: 1.5rem;
		line-height: 1;
		color: #00296b99;
		cursor: pointer;
		padding: 0 0.2rem;
	}

	.close:hover {
		color: #00296b;
	}

	.back {
		margin-top: 0.65rem;
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		font-size: 0.75rem;
		font-weight: 600;
		color: #1b75e0;
		cursor: pointer;
	}

	section {
		padding: 0.9rem 1rem;
		border-bottom: 1px solid #00296b0d;
	}

	.sw {
		display: inline-block;
		width: 0.9rem;
		height: 0.9rem;
		border-radius: 0.2rem;
		margin-top: 0.25rem;
		flex-shrink: 0;
	}

	.chip {
		display: inline-block;
		width: 0.65rem;
		height: 0.65rem;
		margin-right: 0.35rem;
		border-radius: 0.15rem;
		vertical-align: baseline;
	}

	.muted {
		margin: 0 0 0.5rem;
		font-size: 0.72rem;
		color: #00296b99;
	}

	.muted:empty {
		display: none;
	}

	.note {
		margin: 0.5rem 0 0;
	}

	.facts {
		margin: 0;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}

	dt {
		font-size: 0.68rem;
		color: #00296b99;
	}

	dd {
		margin: 0.15rem 0 0;
		font-size: 0.95rem;
		font-weight: 700;
	}

	dd small {
		display: block;
		font-size: 0.7rem;
		font-weight: 400;
		color: #00296b99;
	}

	dd small.inline {
		display: inline;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.74rem;
	}

	th {
		text-align: left;
		font-weight: 600;
		color: #00296b99;
		padding: 0.3rem 0.3rem 0.3rem 0;
		border-bottom: 1px solid #00296b1a;
	}

	td {
		padding: 0.28rem 0.3rem 0.28rem 0;
		border-bottom: 1px solid #00296b0d;
	}

	tr.sel td {
		font-weight: 700;
		background: #00296b08;
	}

	.crop {
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		color: inherit;
		cursor: pointer;
		text-align: left;
	}

	.crop:hover {
		text-decoration: underline dotted #00296b66;
	}

	.kn {
		display: block;
		font-weight: 600;
		line-height: 1.25;
	}

	.en {
		display: block;
		font-size: 0.68rem;
		font-weight: 500;
		color: #00296b99;
	}

	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.barcell {
		width: 22%;
	}

	.barcell span {
		display: block;
		height: 0.45rem;
		border-radius: 0.2rem;
		min-width: 1px;
	}

	.hist {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.hrow {
		display: grid;
		grid-template-columns: 5.6rem 1fr 3rem;
		align-items: center;
		gap: 0.4rem;
		border: none;
		background: none;
		padding: 1px 0;
		font: inherit;
		color: inherit;
		cursor: pointer;
		text-align: left;
	}

	.hrow:hover .hlabel,
	.hrow.on .hlabel {
		font-weight: 700;
	}

	.hrow.on .hbar {
		outline: 1.5px solid #e11d48;
		outline-offset: 1px;
	}

	.hlabel {
		font-size: 0.68rem;
		white-space: nowrap;
	}

	.hbar {
		display: flex;
		height: 0.7rem;
		min-width: 2px;
		border-radius: 2px;
		overflow: hidden;
	}

	.hval {
		font-size: 0.66rem;
		text-align: right;
		color: #00296b99;
		font-variant-numeric: tabular-nums;
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

	@media (max-width: 768px) {
		.panel {
			width: 100%;
			border-left: none;
			border-top: 1px solid color-mix(in srgb, #00296b 12%, white);
		}
	}
</style>
