<script lang="ts">
	import CropHistoryChart from '$lib/components/CropHistoryChart.svelte';
	import {
		LAYER_BY_TYPE,
		cropColor,
		formatCropLabel,
		formatDate,
		formatPct,
		geometryCenter,
		seasonBars,
		type AgriFeature
	} from '$lib/tlab';

	interface Props {
		feature: AgriFeature;
		cellToken: string | null;
		onClose: () => void;
	}

	let { feature, cellToken, onClose }: Props = $props();

	const attrs = $derived(feature.properties ?? { alu_type: 'unknown' });
	const def = $derived(LAYER_BY_TYPE[attrs.alu_type]);
	const center = $derived(geometryCenter(feature.geometry));
	const bars = $derived(seasonBars(attrs.monitoring_prediction));

	const area = $derived(attrs.area_sq_m ?? null);

	const topCrop = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const b of bars) {
			const lead = b.segments[0]?.crop;
			if (lead && lead !== 'UNKNOWN_CROP' && lead !== 'NO_PREDICTION') {
				counts.set(lead, (counts.get(lead) ?? 0) + 1);
			}
		}
		const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
		return best ? { crop: best[0], seasons: best[1] } : null;
	});

	const rawProps = $derived(
		Object.entries(attrs).filter(([k]) => k !== 'monitoring_prediction')
	);

	let copied = $state(false);

	async function copyCode() {
		if (!feature.id) return;
		try {
			await navigator.clipboard.writeText(String(feature.id));
			copied = true;
			setTimeout(() => (copied = false), 1200);
		} catch {
			copied = false;
		}
	}
</script>

<aside class="panel" aria-label="Feature details">
	<header>
		<div class="title">
			<span class="sw" style:background={def?.color ?? '#94a3b8'}></span>
			<div>
				<h2>{def?.singular ?? attrs.alu_type}</h2>
				{#if feature.id}
					<button type="button" class="code" onclick={copyCode} title="Copy plus code">
						{feature.id}
						<span>{copied ? 'Copied' : 'Copy'}</span>
					</button>
				{/if}
			</div>
		</div>
		<button type="button" class="close" onclick={onClose} aria-label="Close details">×</button>
	</header>

	<section>
		<dl class="facts">
			<div>
				<dt>Area</dt>
				<dd>
					{#if area != null}
						{(area / 4046.8564224).toFixed(2)} ac
						<small>{Math.round(area).toLocaleString('en-IN')} m² · {(area / 10000).toFixed(2)} ha</small>
					{:else}—{/if}
				</dd>
			</div>
			<div>
				<dt>Classification confidence</dt>
				<dd>{formatPct(attrs.class_confidence)}</dd>
			</div>
			<div>
				<dt>Outline image date</dt>
				<dd>{formatDate(attrs.capture_timestamp_sec)}</dd>
			</div>
			<div>
				<dt>Seasons tracked</dt>
				<dd>{bars.length || '—'}</dd>
			</div>
			{#if topCrop}
				<div class="wide">
					<dt>Most frequent crop</dt>
					<dd>
						<span class="sw sm" style:background={cropColor(topCrop.crop)}></span>
						{formatCropLabel(topCrop.crop)}
						<small>leading in {topCrop.seasons} of {bars.length} seasons</small>
					</dd>
				</div>
			{/if}
			{#if center}
				<div class="wide">
					<dt>Location</dt>
					<dd>
						{center[0].toFixed(5)}, {center[1].toFixed(5)}
						<a
							href="https://www.google.com/maps?q={center[0]},{center[1]}"
							target="_blank"
							rel="noopener noreferrer">Open in Google Maps ↗</a
						>
					</dd>
				</div>
			{/if}
		</dl>
	</section>

	{#if attrs.alu_type === 'field'}
		<section>
			<h3>Crops grown by season</h3>
			<p class="sub">Model confidence for the top 3 predicted crops in each season</p>
			<CropHistoryChart {bars} />
		</section>
	{/if}

	<section>
		<details>
			<summary>All attributes</summary>
			<table>
				<tbody>
					<tr><th>id</th><td>{feature.id ?? '—'}</td></tr>
					<tr><th>geometry</th><td>{feature.geometry.type}</td></tr>
					{#if cellToken}<tr><th>s2_cell</th><td>{cellToken}</td></tr>{/if}
					{#each rawProps as [k, v]}
						<tr><th>{k}</th><td>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</td></tr>
					{/each}
				</tbody>
			</table>
		</details>
	</section>
</aside>

<style>
	.panel {
		width: 22rem;
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
		margin: 0;
		font-size: 0.9rem;
		font-weight: 700;
	}

	.sub {
		margin: 0.2rem 0 0.6rem;
		font-size: 0.72rem;
		color: #00296b99;
	}

	.sw {
		display: inline-block;
		width: 0.9rem;
		height: 0.9rem;
		border-radius: 0.2rem;
		margin-top: 0.25rem;
		flex-shrink: 0;
	}

	.sw.sm {
		width: 0.65rem;
		height: 0.65rem;
		margin: 0 0.2rem 0 0;
		vertical-align: baseline;
	}

	.code {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		margin-top: 0.15rem;
		padding: 0;
		border: none;
		background: none;
		font: inherit;
		font-size: 0.78rem;
		color: #00296bcc;
		cursor: pointer;
	}

	.code span {
		font-size: 0.65rem;
		font-weight: 600;
		color: #1b75e0;
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

	section {
		padding: 0.9rem 1rem;
		border-bottom: 1px solid #00296b0d;
	}

	.facts {
		margin: 0;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}

	.facts .wide {
		grid-column: 1 / -1;
	}

	dt {
		font-size: 0.68rem;
		color: #00296b99;
	}

	dd {
		margin: 0.15rem 0 0;
		font-size: 0.9rem;
		font-weight: 700;
	}

	dd small {
		display: block;
		font-size: 0.7rem;
		font-weight: 400;
		color: #00296b99;
	}

	dd a {
		display: block;
		margin-top: 0.15rem;
		font-size: 0.72rem;
		font-weight: 600;
		color: #1b75e0;
		text-decoration: none;
	}

	dd a:hover {
		text-decoration: underline;
	}

	summary {
		font-size: 0.82rem;
		font-weight: 700;
		cursor: pointer;
	}

	table {
		width: 100%;
		margin-top: 0.5rem;
		border-collapse: collapse;
		font-size: 0.72rem;
	}

	th,
	td {
		text-align: left;
		vertical-align: top;
		padding: 0.25rem 0.4rem 0.25rem 0;
		border-bottom: 1px solid #00296b0d;
		word-break: break-all;
	}

	th {
		font-weight: 600;
		color: #00296b99;
		white-space: nowrap;
		width: 1%;
	}

	@media (max-width: 768px) {
		.panel {
			width: 100%;
			border-left: none;
			border-top: 1px solid color-mix(in srgb, #00296b 12%, white);
		}
	}
</style>
