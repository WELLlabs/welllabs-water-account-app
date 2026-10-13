<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		subtitle?: string;
		/** Omit to render the section without an on/off switch */
		on?: boolean;
		onToggle?: (on: boolean) => void;
		open?: boolean;
		swatch?: string;
		/** One-of-a-group layer: a radio instead of a switch (clicking the active one turns it off) */
		exclusive?: boolean;
		children: Snippet;
	}

	let { title, subtitle, on, onToggle, open = $bindable(true), swatch, exclusive = false, children }: Props = $props();
	const id = `tlab-sec-${Math.random().toString(36).slice(2, 9)}`;
</script>

<section class="sec" class:sec-off={on === false}>
	<header class="sec-head">
		<button
			type="button"
			class="sec-toggle"
			aria-expanded={open}
			aria-controls={id}
			onclick={() => (open = !open)}
		>
			<svg class="sec-chev" class:sec-chev-open={open} viewBox="0 0 16 16" aria-hidden="true">
				<path d="M6 4l4 4-4 4" />
			</svg>
			{#if swatch}<span class="sec-swatch" style:background={swatch}></span>{/if}
			<span class="sec-titles">
				<span class="sec-title">{title}</span>
				{#if subtitle}<span class="sec-sub">{subtitle}</span>{/if}
			</span>
		</button>
		{#if on !== undefined && exclusive}
			<button
				type="button"
				role="radio"
				class="sec-radio"
				aria-checked={on}
				aria-label={on ? `Hide ${title}` : `Show ${title} (replaces the current data layer)`}
				title={on ? 'Click to hide' : 'Show this data layer'}
				onclick={() => onToggle?.(!on)}
			>
				<span class="sec-dot"></span>
			</button>
		{:else if on !== undefined}
			<button
				type="button"
				role="switch"
				class="sec-switch"
				aria-checked={on}
				aria-label={`${on ? 'Hide' : 'Show'} ${title}`}
				onclick={() => onToggle?.(!on)}
			>
				<span class="sec-knob"></span>
			</button>
		{/if}
	</header>
	{#if open}
		<div class="sec-body" {id}>
			{@render children()}
		</div>
	{/if}
</section>

<style>
	.sec {
		background: white;
		border: 1px solid color-mix(in srgb, #00296b 10%, white);
		border-radius: 0.6rem;
		overflow: hidden;
		flex-shrink: 0;
	}

	.sec-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.55rem 0.7rem 0.55rem 0.45rem;
	}

	.sec-toggle {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.45rem;
		background: none;
		border: none;
		padding: 0.15rem 0.2rem;
		border-radius: 0.35rem;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.sec-toggle:hover {
		background: color-mix(in srgb, #1b75e0 6%, white);
	}

	.sec-chev {
		width: 0.9rem;
		height: 0.9rem;
		flex-shrink: 0;
		fill: none;
		stroke: color-mix(in srgb, #00296b 55%, white);
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
		transition: rotate 0.15s ease;
	}

	.sec-chev-open {
		rotate: 90deg;
	}

	.sec-swatch {
		width: 0.85rem;
		height: 0.85rem;
		border-radius: 0.2rem;
		flex-shrink: 0;
	}

	.sec-titles {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.sec-title {
		font-size: 0.85rem;
		font-weight: 700;
		line-height: 1.25;
	}

	.sec-sub {
		font-size: 0.68rem;
		color: color-mix(in srgb, #00296b 55%, white);
		line-height: 1.3;
	}

	.sec-off .sec-title {
		color: color-mix(in srgb, #00296b 55%, white);
	}

	.sec-switch {
		position: relative;
		width: 2.1rem;
		height: 1.2rem;
		flex-shrink: 0;
		border-radius: 999px;
		border: none;
		background: #cbd5e1;
		cursor: pointer;
		transition: background 0.15s ease;
	}

	.sec-switch[aria-checked='true'] {
		background: #1b75e0;
	}

	.sec-knob {
		position: absolute;
		top: 0.15rem;
		left: 0.15rem;
		width: 0.9rem;
		height: 0.9rem;
		border-radius: 50%;
		background: white;
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.25);
		transition: translate 0.15s ease;
	}

	.sec-switch[aria-checked='true'] .sec-knob {
		translate: 0.9rem 0;
	}

	.sec-radio {
		width: 1.15rem;
		height: 1.15rem;
		flex-shrink: 0;
		margin-right: 0.45rem;
		border-radius: 50%;
		border: 2px solid #cbd5e1;
		background: white;
		display: grid;
		place-items: center;
		cursor: pointer;
		transition: border-color 0.15s ease;
	}

	.sec-radio[aria-checked='true'] {
		border-color: #1b75e0;
	}

	.sec-dot {
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 50%;
		background: #1b75e0;
		scale: 0;
		transition: scale 0.15s ease;
	}

	.sec-radio[aria-checked='true'] .sec-dot {
		scale: 1;
	}

	.sec-radio:focus-visible,
	.sec-switch:focus-visible,
	.sec-toggle:focus-visible {
		outline: 2px solid #1b75e0;
		outline-offset: 2px;
	}

	.sec-body {
		padding: 0.1rem 0.85rem 0.85rem;
	}
</style>
