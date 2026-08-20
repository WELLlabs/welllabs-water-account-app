<script lang="ts">
	import BrandAiMark from '$lib/components/BrandAiMark.svelte';
</script>

<svelte:head>
	<title>About · AI @ WELL Labs</title>
</svelte:head>

<div class="page">
	<header class="bar">
		<div class="bar-inner">
			<a href="/" class="brand-link" aria-label="AI @ WELL Labs home">
				<BrandAiMark heightRem={2.4} maxWidthPx={260} />
			</a>
			<nav class="bar-nav" aria-label="Primary">
				<a href="/about" class="bar-link bar-link-active" aria-current="page">About</a>
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

	<main class="main">
		<div class="main-inner">
			<h1>About AI.WELLLabs</h1>
			<div class="prose">
				<p>
					The Digital Futures initiative at WELL Labs is focused on 5 themes. These include the
					Access, Availability, and Aggregation of data on the one hand, and digital tools that
					enable Analysis and Anticipation.
				</p>
				<p>
					ai.welllabs.org is a destination where we intend to publish all of these data products and
					digital tools.
				</p>
				<p>
					We will be publishing datasets, GIS-based tools, productised AI pipelines, and modeling
					engines. As with all of the work that we do at WELL Labs, the starting point will be water,
					but that will by no means be the end.
				</p>
				<p>All of our data and tools will be open source and free to use.</p>
				<p>
					Our ambition is to provide more agency to those working in the ecosystem, especially to
					those who are working in the field. That is the only way all this work can move the needle
					for the sector.
				</p>
			</div>
		</div>
	</main>

	<footer class="foot">
		<div class="foot-inner">
			<span>ai.welllabs.org</span>
			<a href="https://welllabs.org" target="_blank" rel="noopener noreferrer">
				WELL Labs Website · welllabs.org
			</a>
		</div>
	</footer>
</div>

<style>
	.page {
		--ink: #00296b;
		--ink-soft: color-mix(in srgb, #00296b 78%, white);
		--muted: color-mix(in srgb, #00296b 55%, white);
		--paper: #f4f7fb;
		--line: color-mix(in srgb, #00296b 14%, white);
		--accent: #1b75e0;
		--accent-deep: #00296b;
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		background: var(--paper);
		color: var(--ink);
		font-family: 'Montserrat', sans-serif;
	}

	.bar {
		position: sticky;
		top: 0;
		z-index: 20;
		border-bottom: 1px solid color-mix(in srgb, var(--line) 80%, transparent);
		background: color-mix(in srgb, var(--paper) 88%, white);
		backdrop-filter: blur(10px);
	}

	.bar-inner,
	.main-inner,
	.foot-inner {
		width: min(1100px, calc(100% - 2.5rem));
		margin-inline: auto;
	}

	.bar-inner {
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

	.bar-link:hover,
	.bar-link-active {
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

	.main {
		flex: 1;
		padding: 3.5rem 0 4rem;
	}

	.main-inner h1 {
		margin: 0;
		font-family: 'Josefin Sans', sans-serif;
		font-size: clamp(2rem, 4vw, 2.75rem);
		font-weight: 700;
		letter-spacing: -0.02em;
	}

	.prose {
		margin-top: 1.75rem;
		max-width: 42rem;
	}

	.prose p {
		margin: 0 0 1.15rem;
		font-size: 1.05rem;
		line-height: 1.7;
		color: var(--ink-soft);
	}

	.prose p:last-child {
		margin-bottom: 0;
	}

	.foot {
		border-top: 1px solid var(--line);
		padding: 1.5rem 0 2rem;
	}

	.foot-inner {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0.75rem;
		color: var(--muted);
		font-size: 0.85rem;
	}

	.foot a {
		color: var(--accent);
		font-weight: 600;
		text-decoration: none;
	}

	.foot a:hover {
		color: var(--ink);
	}
</style>
