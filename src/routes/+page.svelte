<script lang="ts">
	import BrandAiMark from '$lib/components/BrandAiMark.svelte';

	const dataLayers = [
		{
			title: 'Bengaluru Citizen Observatory',
			description:
				'This GEE app includes layers pertaining to the administrative boundaries of Bengaluru, along with hydrology layers such as watersheds, catchments, drainage networks, and flood risk zones. In addition, we have layers that highlight rejuvenation work undertaken in the city.',
			href: 'https://gcp-welllabs.projects.earthengine.app/view/urban-water'
		},
		{
			title: 'Rural Futures',
			description:
				'This GEE app contains data layers relating to the state of Karnataka, where both our transformation labs are located. It has layers relating to the administrative boundaries, land use, hydrological features such as watersheds, drainage, etc., and finally details of the canal command in the Raichur district, which is one of our transformation labs.',
			href: 'https://gcp-welllabs.projects.earthengine.app/view/rural-futures'
		},
		{
			title: 'River Water Quality Data',
			description:
				'The Central Pollution Control Board collects data on water quality across the length of all major Indian rivers. This GEE App brings all of that data synthesised in a form where you can look at the water quality by station across a 12-year period.',
			href: 'https://gcp-welllabs.projects.earthengine.app/view/india-river-water-quality'
		},
		{
			title: 'Groundwater Data',
			description:
				'The Central Ground Water Board monitors thousands of wells across India where it collects groundwater levels. This GEE App contains the data across 5 years for the wells tracked. This makes the data accessible spatially.',
			href: 'https://gcp-welllabs.projects.earthengine.app/view/ground-water-mapping'
		}
	];

	const digitalSolutions = [
		{
			title: 'Farm Water Accounting',
			description:
				'The Farm Water Accounting App helps match water demand and supply in rural landscapes. Farmer collectives can map cropping patterns across a Water User Association to estimate demand, then balance it against supply available to assess equity. The toolset includes creating QField-ready survey forms, visualising collected data, planning crop water use, and balancing supply components in millimetres.',
			status: 'live' as const,
			href: '/fwa'
		},
		{
			title: 'Water Security Toolbox',
			description:
				'The Water Security Toolbox makes hydrology accessible for field-level water security programmes across rural India. It combines GIS layers with local intelligence to power three tools that scientifically diagnose problems in a landscape, design relevant solutions, and assess the impact of interventions through continuous monitoring.',
			status: 'coming' as const,
			href: null
		},
		{
			title: 'Wastewater Audit Tool',
			description:
				'To help Resident Welfare Associations that run decentralised sewage treatment plants (STPs) face and manage audits of their STPs. The tool also helps them evaluate upgrades and repairs.',
			status: 'coming' as const,
			href: null
		},
		{
			title: 'Bengaluru Flood Reporting Tool',
			description:
				'We have built a tool to collect flooding data points across Bengaluru using this citizen engagement tool to better calibrate flood models.',
			status: 'coming' as const,
			href: null
		}
	];

	/** Triplicate for seamless endless scroll */
	const carouselLayers = [...dataLayers, ...dataLayers, ...dataLayers];

	let carouselEl = $state<HTMLElement | null>(null);
	let scrolling = false;

	function thumbSrc(title: string): string {
		return `/landing_page_images/${encodeURIComponent(title)}.png`;
	}

	function onThumbError(e: Event) {
		const img = e.currentTarget as HTMLImageElement;
		img.style.display = 'none';
		const fallback = img.nextElementSibling as HTMLElement | null;
		if (fallback) fallback.hidden = false;
	}

	function setWidth(): number {
		const el = carouselEl;
		if (!el) return 0;
		return el.scrollWidth / 3;
	}

	function cardStep(): number {
		const el = carouselEl;
		if (!el) return 0;
		const card = el.querySelector('.layer-card') as HTMLElement | null;
		if (!card) return el.clientWidth * 0.3;
		const styles = getComputedStyle(el);
		const gap = parseFloat(styles.columnGap || styles.gap || '12') || 12;
		return card.offsetWidth + gap;
	}

	/** Keep scroll position inside the middle copy of the loop */
	function normalizeLoop(instant = false) {
		const el = carouselEl;
		if (!el) return;
		const w = setWidth();
		if (w <= 0) return;
		if (el.scrollLeft < w * 0.5) {
			if (instant) el.style.scrollBehavior = 'auto';
			el.scrollLeft += w;
			if (instant) el.style.scrollBehavior = '';
		} else if (el.scrollLeft >= w * 1.5) {
			if (instant) el.style.scrollBehavior = 'auto';
			el.scrollLeft -= w;
			if (instant) el.style.scrollBehavior = '';
		}
	}

	function onCarouselScroll() {
		if (scrolling) return;
		normalizeLoop(true);
	}

	async function scrollCarousel(dir: -1 | 1) {
		const el = carouselEl;
		if (!el || scrolling) return;
		scrolling = true;
		const step = cardStep();
		el.scrollBy({ left: dir * step, behavior: 'smooth' });
		await new Promise<void>((resolve) => {
			let settled = false;
			const done = () => {
				if (settled) return;
				settled = true;
				el.removeEventListener('scrollend', done);
				resolve();
			};
			el.addEventListener('scrollend', done, { once: true });
			setTimeout(done, 500);
		});
		normalizeLoop(true);
		scrolling = false;
	}

	$effect(() => {
		const el = carouselEl;
		if (!el) return;
		// Start in the middle set so both directions are endless
		requestAnimationFrame(() => {
			const w = setWidth();
			if (w > 0) {
				el.style.scrollBehavior = 'auto';
				el.scrollLeft = w;
				el.style.scrollBehavior = '';
			}
		});
	});
</script>

<svelte:head>
	<title>AI @ WELL Labs</title>
</svelte:head>

<div class="landing">
	<header class="landing-bar">
		<div class="landing-bar-inner">
			<a href="/" class="brand-link" aria-label="AI @ WELL Labs home">
				<BrandAiMark heightRem={2.4} maxWidthPx={260} />
			</a>
			<nav class="bar-nav" aria-label="Primary">
				<a href="/about" class="bar-link">About</a>
				<a href="/contact" class="bar-link">Contact Us</a>
				<a
					href="https://welllabs.org"
					target="_blank"
					rel="noopener noreferrer"
					class="bar-cta"
				>
					WELL Labs Website
				</a>
			</nav>
		</div>
	</header>

	<section class="hero">
		<div class="hero-wash" aria-hidden="true"></div>
		<div class="hero-inner">
			<h1 class="hero-title">Data Layers. Digital Solutions.</h1>
			<p class="hero-lead">
				Open data and digital tools from WELL Labs - built so those closest to the problem can act
				on it
			</p>
		</div>
	</section>

	<section class="section section-layers">
		<div class="section-inner">
			<div class="section-head">
				<h2>Data Layers</h2>
				<p>
					We wanted to make datasets on water released by the government, as well as synthesised by
					WELL Labs, easier to access and visualise spatially.
				</p>
			</div>
		</div>
		<div class="carousel">
			<button
				type="button"
				class="carousel-arrow carousel-arrow-prev"
				aria-label="Previous data layers"
				onclick={() => scrollCarousel(-1)}
			>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
					<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
				</svg>
			</button>
			<div
				class="product-list"
				bind:this={carouselEl}
				onscroll={onCarouselScroll}
			>
				{#each carouselLayers as product, i (i)}
					<a class="layer-card" href={product.href} target="_blank" rel="noopener noreferrer">
						<div class="thumb thumb-layer" aria-hidden="true">
							<img src={thumbSrc(product.title)} alt="" loading="lazy" onerror={onThumbError} />
							<span class="thumb-fallback" hidden></span>
						</div>
						<div class="layer-body">
							<h3>{product.title}</h3>
							<p>{product.description}</p>
							<span class="explore-cta">Explore layer</span>
						</div>
					</a>
				{/each}
			</div>
			<button
				type="button"
				class="carousel-arrow carousel-arrow-next"
				aria-label="Next data layers"
				onclick={() => scrollCarousel(1)}
			>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
					<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
				</svg>
			</button>
		</div>
	</section>

	<section class="section section-alt">
		<div class="section-inner">
			<div class="section-head">
				<h2>Digital Solutions</h2>
				<p>
					We translate our understanding of water and hydrology into tools that can be used in rural
					and urban landscapes to understand and solve problems experienced on the ground.
				</p>
			</div>
			<div class="platform-grid">
				{#each digitalSolutions as item}
					{#if item.href}
						<a class="platform-card platform-card-live" href={item.href}>
							<div class="thumb thumb-card" aria-hidden="true">
								<img src={thumbSrc(item.title)} alt="" loading="lazy" onerror={onThumbError} />
								<span class="thumb-fallback" hidden></span>
							</div>
							<div class="platform-body">
								<div class="platform-top">
									<h3>{item.title}</h3>
									<span class="badge badge-live">Available</span>
								</div>
								<p>{item.description}</p>
								<span class="open-cta">Open app →</span>
							</div>
						</a>
					{:else}
						<div class="platform-card">
							<div class="thumb thumb-card" aria-hidden="true">
								<img src={thumbSrc(item.title)} alt="" loading="lazy" onerror={onThumbError} />
								<span class="thumb-fallback" hidden></span>
							</div>
							<div class="platform-body">
								<div class="platform-top">
									<h3>{item.title}</h3>
									<span class="badge">Coming soon</span>
								</div>
								<p>{item.description}</p>
							</div>
						</div>
					{/if}
				{/each}
			</div>
		</div>
	</section>

	<footer class="landing-foot">
		<div class="landing-foot-inner">
			<span>ai.welllabs.org</span>
			<a href="https://welllabs.org" target="_blank" rel="noopener noreferrer">
				WELL Labs Website · welllabs.org
			</a>
		</div>
	</footer>
</div>

<style>
	.landing {
		--ink: #00296b;
		--ink-soft: color-mix(in srgb, #00296b 78%, white);
		--muted: color-mix(in srgb, #00296b 55%, white);
		--paper: #f4f7fb;
		--panel: #ffffff;
		--line: color-mix(in srgb, #00296b 14%, white);
		--accent: #1b75e0;
		--accent-deep: #00296b;
		--sand: color-mix(in srgb, #1b75e0 8%, white);
		min-height: 100vh;
		background: var(--paper);
		color: var(--ink);
		font-family: 'Montserrat', sans-serif;
	}

	.landing-bar {
		position: sticky;
		top: 0;
		z-index: 20;
		border-bottom: 1px solid color-mix(in srgb, var(--line) 80%, transparent);
		background: color-mix(in srgb, var(--paper) 88%, white);
		backdrop-filter: blur(10px);
	}

	.landing-bar-inner,
	.hero-inner,
	.section-inner,
	.landing-foot-inner {
		width: min(1100px, calc(100% - 2.5rem));
		margin-inline: auto;
	}

	.landing-bar-inner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.9rem 0;
	}

	.brand-link {
		display: flex;
		align-items: center;
		text-decoration: none;
		color: inherit;
	}

	.bar-nav {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: 0.35rem 0.85rem;
	}

	.bar-link {
		padding: 0.45rem 0.35rem;
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--ink-soft);
		text-decoration: none;
		transition: color 160ms ease;
	}

	.bar-link:hover {
		color: var(--accent);
	}

	.bar-cta {
		border-radius: 999px;
		background: var(--accent);
		color: white;
		padding: 0.55rem 1rem;
		font-size: 0.85rem;
		font-weight: 600;
		text-decoration: none;
		transition: background 160ms ease;
	}

	.bar-cta:hover {
		background: var(--accent-deep);
	}

	/* Hero band for future bg image: ~1920×720 design canvas */
	.hero {
		position: relative;
		overflow: hidden;
		display: flex;
		align-items: center;
		min-height: clamp(32rem, 70vh, 45rem);
		padding: 5rem 0;
		border-bottom: 1px solid var(--line);
	}

	.hero-wash {
		position: absolute;
		inset: 0;
		background:
			radial-gradient(ellipse 70% 80% at 85% 10%, color-mix(in srgb, #1b75e0 28%, white) 0%, transparent 55%),
			radial-gradient(ellipse 55% 60% at 5% 90%, color-mix(in srgb, #00296b 12%, white) 0%, transparent 50%),
			linear-gradient(180deg, #eaf1fb 0%, var(--paper) 100%);
		pointer-events: none;
	}

	.hero-inner {
		position: relative;
	}

	.hero-title {
		margin: 0;
		max-width: 16ch;
		font-family: 'Josefin Sans', sans-serif;
		font-size: clamp(2.2rem, 5.5vw, 3.8rem);
		font-weight: 700;
		line-height: 1.08;
		letter-spacing: -0.03em;
		color: var(--ink);
	}

	.hero-lead {
		margin: 1.4rem 0 0;
		max-width: 42rem;
		font-size: 1.08rem;
		line-height: 1.65;
		color: var(--ink-soft);
	}

	.section {
		padding: 4rem 0;
	}

	.section-alt {
		background: var(--sand);
		border-block: 1px solid var(--line);
	}

	.section-head {
		margin-bottom: 1.75rem;
	}

	.section-head h2 {
		margin: 0;
		font-family: 'Josefin Sans', sans-serif;
		font-size: clamp(1.6rem, 3vw, 2.1rem);
		font-weight: 700;
		letter-spacing: -0.02em;
	}

	.section-head p {
		margin: 0.55rem 0 0;
		max-width: 44rem;
		color: var(--muted);
		line-height: 1.55;
	}

	.thumb {
		position: relative;
		overflow: hidden;
		background: var(--accent);
		flex-shrink: 0;
	}

	.thumb img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.thumb-fallback {
		display: block;
		width: 100%;
		height: 100%;
		background: var(--accent);
	}

	.thumb-fallback[hidden] {
		display: none;
	}

	.thumb-layer {
		width: 100%;
		aspect-ratio: 16 / 10;
	}

	.thumb-card {
		width: 100%;
		aspect-ratio: 16 / 9;
	}

	.carousel {
		position: relative;
		width: 100%;
	}

	.carousel-arrow {
		position: absolute;
		top: 38%;
		z-index: 3;
		translate: 0 -50%;
		display: grid;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		border: 1px solid var(--line);
		border-radius: 0;
		background: color-mix(in srgb, var(--panel) 92%, transparent);
		color: var(--ink);
		cursor: pointer;
		box-shadow: 0 2px 12px color-mix(in srgb, #00296b 16%, transparent);
		transition:
			background 160ms ease,
			color 160ms ease;
	}

	.carousel-arrow-prev {
		left: 0.5rem;
	}

	.carousel-arrow-next {
		right: 0.5rem;
	}

	.carousel-arrow:hover {
		background: var(--accent);
		color: white;
		border-color: var(--accent);
	}

	.carousel-arrow svg {
		width: 1.25rem;
		height: 1.25rem;
	}

	.section-layers .product-list {
		display: flex;
		gap: 0.75rem;
		width: 100%;
		margin: 0;
		padding: 0;
		overflow-x: auto;
		scroll-snap-type: x mandatory;
		scroll-behavior: smooth;
		scrollbar-width: none;
		-ms-overflow-style: none;
	}

	.section-layers .product-list::-webkit-scrollbar {
		display: none;
	}

	/* ~3 cards + slight peek of the 4th under the arrow */
	.layer-card {
		display: flex;
		flex: 0 0 calc((100% - 2.25rem) / 3.28);
		flex-direction: column;
		min-width: 0;
		max-width: calc((100% - 2.25rem) / 3.28);
		border: 1px solid var(--line);
		border-radius: 0;
		background: var(--panel);
		overflow: hidden;
		scroll-snap-align: start;
		text-decoration: none;
		color: inherit;
		transition: border-color 160ms ease;
	}

	.layer-card:hover {
		border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
	}

	.layer-body {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0.55rem;
		padding: 1rem 1.05rem 1.15rem;
	}

	.layer-body h3 {
		margin: 0;
		font-family: 'Josefin Sans', sans-serif;
		font-size: 1.05rem;
		font-weight: 600;
		letter-spacing: -0.01em;
	}

	.layer-body p,
	.platform-card p {
		margin: 0;
		color: var(--muted);
		font-size: 0.88rem;
		line-height: 1.5;
	}

	.explore-cta,
	.open-cta {
		margin-top: auto;
		padding-top: 0.35rem;
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--accent);
	}

	.explore-cta {
		font-size: 0.85rem;
	}

	.platform-grid {
		display: grid;
		gap: 1rem;
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.platform-card {
		display: flex;
		flex-direction: column;
		gap: 0;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: 0;
		background: var(--panel);
		overflow: hidden;
		text-decoration: none;
		color: inherit;
	}

	.platform-body {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0.7rem;
		padding: 0.9rem 1rem 1.1rem;
	}

	.platform-card-live {
		transition: border-color 160ms ease;
	}

	.platform-card-live:hover {
		border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
	}

	.platform-top {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.platform-card h3 {
		margin: 0;
		font-family: 'Josefin Sans', sans-serif;
		font-size: 1.1rem;
		font-weight: 600;
		letter-spacing: -0.01em;
	}

	.badge {
		flex-shrink: 0;
		border-radius: 0;
		padding: 0.25rem 0.55rem;
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--muted);
		background: var(--sand);
		border: 1px solid var(--line);
	}

	.badge-live {
		color: #00296b;
		background: color-mix(in srgb, #1b75e0 18%, white);
		border-color: color-mix(in srgb, #1b75e0 35%, white);
	}

	.landing-foot {
		border-top: 1px solid var(--line);
		padding: 1.5rem 0 2rem;
	}

	.landing-foot-inner {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0.75rem;
		color: var(--muted);
		font-size: 0.85rem;
	}

	.landing-foot a {
		color: var(--accent);
		font-weight: 600;
		text-decoration: none;
	}

	.landing-foot a:hover {
		color: var(--ink);
	}

	@media (max-width: 1100px) {
		.layer-card {
			flex-basis: calc((100% - 0.75rem) / 2.2);
			max-width: calc((100% - 0.75rem) / 2.2);
		}
	}

	@media (max-width: 720px) {
		.layer-card {
			flex-basis: 78%;
			max-width: 78%;
		}

		.platform-grid {
			grid-template-columns: 1fr;
		}

		.hero {
			min-height: 28rem;
			padding: 3.5rem 0;
		}

		.hero-title {
			max-width: none;
		}
	}
</style>
