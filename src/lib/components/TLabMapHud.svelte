<script lang="ts">
	import type { Snippet } from 'svelte';

	export interface HudSeason {
		key: string;
		label: string;
	}

	export interface HudKeyItem {
		color: string;
		label: string;
		count?: string;
	}

	interface Props {
		title: string;
		years: number[];
		year: number | null;
		onYear: (year: number) => void;
		seasons: HudSeason[];
		seasonKey: string | null;
		onSeason: (key: string) => void;
		extra?: Snippet;
		facts?: Snippet;
		legend?: Snippet;
		legendItems?: HudKeyItem[];
		legendNote?: string;
		rampColors?: string[];
		rampTicks?: string[];
	}

	let {
		title,
		years,
		year,
		onYear,
		seasons,
		seasonKey,
		onSeason,
		extra,
		facts,
		legend,
		legendItems = [],
		legendNote = '',
		rampColors = [],
		rampTicks = []
	}: Props = $props();

	let collapsed = $state(false);
</script>

<div class="ctl" class:collapsed role="region" aria-label="{title} season and legend">
	<div class="head">
		<span class="title">{title}</span>
		<button type="button" class="toggle" onclick={() => (collapsed = !collapsed)} aria-expanded={!collapsed}>
			{collapsed ? 'Show' : 'Hide'}
		</button>
	</div>

	{#if !collapsed}
		{#if years.length && seasons.length}
			<div class="pick">
				<label>
					<span>Year</span>
					<select value={year} onchange={(e) => onYear(Number(e.currentTarget.value))}>
						{#each years as y}<option value={y}>{y}</option>{/each}
					</select>
				</label>
				<label class="grow">
					<span>Season</span>
					<select value={seasonKey} onchange={(e) => onSeason(e.currentTarget.value)}>
						{#each seasons as s (s.key)}<option value={s.key}>{s.label}</option>{/each}
					</select>
				</label>
			</div>
		{/if}

		{#if extra}
			<div class="extra">{@render extra()}</div>
		{/if}

		{#if facts}{@render facts()}{/if}

		{#if legend}
			{@render legend()}
		{:else if rampColors.length}
			<div class="ramp">
				<div class="bar">
					{#each rampColors as c}<span style:background={c}></span>{/each}
				</div>
				{#if rampTicks.length}
					<div class="ticks">
						{#each rampTicks as t, i}
							<span style:left="{((i + 1) / (rampTicks.length + 1)) * 100}%">{t}</span>
						{/each}
					</div>
				{/if}
			</div>
			{#if legendNote}<p class="note">{legendNote}</p>{/if}
		{:else if legendItems.length}
			<ul class="key">
				{#each legendItems as item}
					<li>
						<span class="sw" style:background={item.color}></span>
						<span class="lab">{item.label}</span>
						{#if item.count}<span class="n">{item.count}</span>{/if}
					</li>
				{/each}
			</ul>
			{#if legendNote}<p class="note">{legendNote}</p>{/if}
		{/if}
	{/if}
</div>

<style>
	.ctl {
		position: absolute;
		left: 0.75rem;
		bottom: 2.2rem;
		z-index: 800;
		width: 19rem;
		padding: 0.6rem 0.75rem 0.65rem;
		border-radius: 0.6rem;
		background: rgba(255, 255, 255, 0.96);
		box-shadow: 0 4px 16px rgba(0, 41, 107, 0.18);
		font-family: 'Montserrat', sans-serif;
		color: #00296b;
	}

	.ctl.collapsed {
		width: auto;
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.title {
		font-size: 0.78rem;
		font-weight: 700;
	}

	.toggle {
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		font-size: 0.7rem;
		font-weight: 600;
		color: #1b75e0;
		cursor: pointer;
	}

	.pick,
	.extra {
		display: flex;
		gap: 0.4rem;
		margin-top: 0.5rem;
	}

	.pick label,
	.extra :global(label) {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		font-size: 0.64rem;
		color: #00296b99;
		min-width: 0;
	}

	.pick .grow,
	.extra :global(label.grow) {
		flex: 1;
		min-width: 0;
	}

	select,
	.extra :global(select) {
		width: 100%;
		padding: 0.25rem 0.3rem;
		border: 1px solid #00296b26;
		border-radius: 0.35rem;
		background: white;
		font: inherit;
		font-size: 0.72rem;
		color: #00296b;
	}

	.key {
		list-style: none;
		margin: 0.55rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.18rem;
		max-height: 9.5rem;
		overflow: auto;
	}

	.key li {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		font-size: 0.68rem;
	}

	.sw {
		width: 0.65rem;
		height: 0.65rem;
		border-radius: 0.12rem;
		flex-shrink: 0;
		box-shadow: inset 0 0 0 1px #00296b22;
		translate: 0 0.08rem;
	}

	.lab {
		flex: 1;
		min-width: 0;
		line-height: 1.25;
	}

	.n {
		color: #00296b99;
		font-variant-numeric: tabular-nums;
	}

	.note {
		margin: 0.35rem 0 0;
		font-size: 0.6rem;
		color: #00296b99;
	}

	.ramp {
		margin-top: 0.55rem;
	}

	.bar {
		display: flex;
		height: 0.55rem;
		border-radius: 999px;
		overflow: hidden;
	}

	.bar span {
		flex: 1;
	}

	.ticks {
		position: relative;
		height: 0.8rem;
		margin-top: 0.15rem;
		font-size: 0.58rem;
		color: #00296b99;
	}

	.ticks span {
		position: absolute;
		translate: -50% 0;
		white-space: nowrap;
	}
</style>
