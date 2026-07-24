<script lang="ts">
	const dataProducts = [
		{
			title: 'Bangalore Citizen Observatory',
			description:
				'We have been collecting data about the city infrastructure and flooding across Bangalore. This GEE App provides all of these datasets.',
			href: 'https://gcp-welllabs.projects.earthengine.app/view/urban-water'
		},
		{
			title: 'Rural Futures',
			description:
				'To support all of our work in Karnataka and Raichur, we have populated a number of spatial datasets in this GEE App.',
			href: 'https://gcp-welllabs.projects.earthengine.app/view/rural-futures'
		},
		{
			title: 'River Water Data Quality',
			description:
				'The CPCB publishes river water quality data for rivers across various sites in India. This has the complete dataset indexed.',
			href: 'https://gcp-welllabs.projects.earthengine.app/view/india-river-water-quality'
		},
		{
			title: 'Groundwater Data',
			description:
				'The CGWB tracks and monitors groundwater data across thousands of wells across India. This GEE App populates all of the data spatially and makes temporal data for each well available on selection.',
			href: 'https://gcp-welllabs.projects.earthengine.app/view/ground-water-mapping'
		}
	];

	const platforms = [
		{
			title: 'Water Security Toolkit',
			description:
				'The Technical Consulting team at WELL Labs has developed the Water Security Toolkit that allows you to Diagnose, Design, and Assess water solutions in rural landscapes across India. The toolkit uses GIS layers in combination with local intelligence to diagnose problems with hydrology at its core and suggest appropriate solutions.',
			status: 'coming' as const,
			href: null
		},
		{
			title: 'Farm Water Accounting App',
			description:
				'In canal command areas, there is a need to match the demand and supply of water in the landscape. Farmer Collectives can determine the cropping across an entire Water User Cooperative Society, and this can be used to estimate the water demand. The demand can then be matched with the supply available at the dam to determine equity.',
			status: 'live' as const,
			href: '/fwa'
		},
		{
			title: 'Climate Solutions Platform',
			description:
				'As a part of our Urban Water Program, we are developing a platform that would highlight nature based solutions that can be deployed across Bangalore to reduce flooding in the city.',
			status: 'coming' as const,
			href: null
		}
	];

	const pipelines = [
		{
			title: 'Canal Vegetation Identification',
			description:
				'We are developing an AI pipeline that will allow canal operators to feed drone data and identify vegetation along the chainage of the canal. This will be helpful in planning repair and maintenance of the canal.'
		},
		{
			title: 'Floodwater Depth',
			description:
				'We are developing an AI pipeline that can assess flooding images and deliver depth data based on various objects in the field of view. This can be used to generate flooding datasets in urban landscapes.'
		}
	];
</script>

<svelte:head>
	<title>ai.welllabs.org — WELL Labs</title>
</svelte:head>

<div class="landing">
	<!-- Top bar -->
	<header class="landing-bar">
		<div class="landing-bar-inner">
			<a href="/" class="brand">
				<span class="brand-mark">WELL Labs</span>
				<span class="brand-sub">ai.welllabs.org</span>
			</a>
			<a
				href="https://welllabs.org"
				target="_blank"
				rel="noopener noreferrer"
				class="bar-cta"
			>
				WELL Labs Website
			</a>
		</div>
	</header>

	<!-- Hero -->
	<section class="hero">
		<div class="hero-wash" aria-hidden="true"></div>
		<div class="hero-inner">
			<p class="hero-kicker">WELL Labs</p>
			<h1 class="hero-title">Data and tools for water landscapes</h1>
			<p class="hero-lead">
				At WELL Labs, we work in both the urban and rural landscapes. Our work in both areas begins
				with science, which requires data. We have been producing data products for this work and
				are publishing them for use by any organisation working in the same landscapes.
			</p>
			<p class="hero-lead hero-lead-secondary">
				We are developing a number of tools that are focused on expanding the agency of those
				working in the landscapes. You can find them all hosted here.
			</p>
		</div>
	</section>

	<!-- Data Products -->
	<section class="section">
		<div class="section-inner">
			<div class="section-head">
				<h2>Data Products</h2>
				<p>Spatial datasets and Earth Engine apps for urban and rural water work.</p>
			</div>
			<div class="product-list">
				{#each dataProducts as product}
					<a class="product-row" href={product.href} target="_blank" rel="noopener noreferrer">
						<div>
							<h3>{product.title}</h3>
							<p>{product.description}</p>
						</div>
						<span class="product-link">Open app</span>
					</a>
				{/each}
			</div>
		</div>
	</section>

	<!-- Tools / Platforms -->
	<section class="section section-alt">
		<div class="section-inner">
			<div class="section-head">
				<h2>Tools, Products and Platforms</h2>
				<p>Applications that help diagnose, plan, and act in water landscapes.</p>
			</div>
			<div class="platform-grid">
				{#each platforms as item}
					{#if item.href}
						<a class="platform-card platform-card-live" href={item.href}>
							<div class="platform-top">
								<h3>{item.title}</h3>
								<span class="badge badge-live">Available</span>
							</div>
							<p>{item.description}</p>
							<span class="platform-cta">Open app →</span>
						</a>
					{:else}
						<div class="platform-card">
							<div class="platform-top">
								<h3>{item.title}</h3>
								<span class="badge">Coming soon</span>
							</div>
							<p>{item.description}</p>
						</div>
					{/if}
				{/each}
			</div>
		</div>
	</section>

	<!-- AI Pipelines -->
	<section class="section">
		<div class="section-inner">
			<div class="section-head">
				<h2>AI Pipelines</h2>
				<p>Models in development for canal maintenance and urban flood assessment.</p>
			</div>
			<div class="pipeline-grid">
				{#each pipelines as pipe}
					<article class="pipeline-card">
						<span class="badge">Coming soon</span>
						<h3>{pipe.title}</h3>
						<p>{pipe.description}</p>
					</article>
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

	.brand {
		display: flex;
		flex-direction: column;
		gap: 0.05rem;
		text-decoration: none;
		color: inherit;
	}

	.brand-mark {
		font-family: 'Josefin Sans', sans-serif;
		font-size: 1.2rem;
		font-weight: 700;
		letter-spacing: -0.02em;
		color: var(--ink);
	}

	.brand-sub {
		font-size: 0.72rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--muted);
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

	.hero {
		position: relative;
		overflow: hidden;
		padding: 4.5rem 0 4rem;
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

	.hero-kicker {
		margin: 0 0 0.75rem;
		font-size: 0.78rem;
		font-weight: 600;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--accent);
	}

	.hero-title {
		margin: 0;
		max-width: 14ch;
		font-family: 'Josefin Sans', sans-serif;
		font-size: clamp(2.4rem, 6vw, 4.2rem);
		font-weight: 700;
		line-height: 1.05;
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

	.hero-lead-secondary {
		margin-top: 0.85rem;
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
		max-width: 40rem;
		color: var(--muted);
		line-height: 1.55;
	}

	.product-list {
		display: grid;
		gap: 0.75rem;
	}

	.product-row {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 1.25rem;
		align-items: center;
		padding: 1.25rem 1.35rem;
		border: 1px solid var(--line);
		border-radius: 1rem;
		background: var(--panel);
		text-decoration: none;
		color: inherit;
		transition:
			border-color 160ms ease,
			transform 160ms ease;
	}

	.product-row:hover {
		border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
		transform: translateY(-1px);
	}

	.product-row h3 {
		margin: 0 0 0.35rem;
		font-family: 'Josefin Sans', sans-serif;
		font-size: 1.05rem;
		font-weight: 600;
	}

	.product-row p,
	.platform-card p,
	.pipeline-card p {
		margin: 0;
		color: var(--muted);
		font-size: 0.95rem;
		line-height: 1.55;
	}

	.product-link {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--accent);
		white-space: nowrap;
	}

	.platform-grid,
	.pipeline-grid {
		display: grid;
		gap: 1rem;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
	}

	.platform-card,
	.pipeline-card {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		padding: 1.4rem;
		border: 1px solid var(--line);
		border-radius: 1.1rem;
		background: var(--panel);
		text-decoration: none;
		color: inherit;
	}

	.platform-card-live {
		transition:
			border-color 160ms ease,
			transform 160ms ease;
	}

	.platform-card-live:hover {
		border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
		transform: translateY(-2px);
	}

	.platform-top {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.platform-card h3,
	.pipeline-card h3 {
		margin: 0;
		font-family: 'Josefin Sans', sans-serif;
		font-size: 1.1rem;
		font-weight: 600;
		letter-spacing: -0.01em;
	}

	.badge {
		flex-shrink: 0;
		border-radius: 999px;
		padding: 0.25rem 0.6rem;
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

	.platform-cta {
		margin-top: auto;
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--accent);
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

	@media (max-width: 720px) {
		.product-row {
			grid-template-columns: 1fr;
			gap: 0.75rem;
		}

		.hero {
			padding: 3.25rem 0 2.75rem;
		}
	}
</style>
