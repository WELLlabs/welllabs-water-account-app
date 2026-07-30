<script lang="ts">
	/** Logo mark: WELL Labs image + sparkle + thin “AI” → always links to site home `/`. */
	interface Props {
		/** Logo image height in rem. */
		heightRem?: number;
		maxWidthPx?: number;
		ariaLabel?: string;
	}

	let {
		heightRem = 2,
		maxWidthPx = 180,
		ariaLabel = 'WELL Labs AI — Home'
	}: Props = $props();

	/*
	  Logo PNG is 1024×227. Measured:
	  - WELL LABS caps: y 64–163 → height ≈ 44% of image
	  - Caps baseline: 63px from bottom → ≈ 27.8% from bottom
	*/
	const aiFontRem = $derived(heightRem * (100 / 227));
	const sparklePx = $derived(Math.max(12, Math.round(heightRem * 7)));
	/* Room for sparkle + AI to the right of the logo (keeps whole mark clickable) */
	const suffixPadRem = $derived(aiFontRem * 2.4);
</script>

<a
	href="/"
	class="brand-ai-mark relative inline-block shrink-0 overflow-visible no-underline"
	aria-label={ariaLabel}
	style="height: {heightRem}rem; padding-right: {suffixPadRem}rem"
>
	<img
		src="/well-labs-logo.png"
		alt="WELL Labs"
		class="block h-full w-auto object-contain object-left"
		style="max-width: {maxWidthPx}px"
	/>
	<span
		class="pointer-events-none absolute flex flex-row items-end gap-1"
		style="left: calc(100% - {suffixPadRem}rem + 0.35rem); bottom: 22%"
	>
		<svg
			class="shrink-0 text-[#1b75e0]"
			viewBox="0 0 24 24"
			width={sparklePx}
			height={sparklePx}
			aria-hidden="true"
			fill="currentColor"
			style="display: block; margin-bottom: 0.02em"
		>
			<path d="M12 1.6 14.1 9.1 21.6 11.2 14.1 13.3 12 20.8 9.9 13.3 2.4 11.2 9.9 9.1 12 1.6Z" />
		</svg>
		<span
			class="block font-light tracking-[0.06em] text-[#1b75e0]"
			style="
				font-family: 'Josefin Sans', sans-serif;
				font-size: {aiFontRem}rem;
				line-height: 1;
				height: 1em;
				transform: translateY(0.08em);
			"
		>
			AI
		</span>
	</span>
</a>
