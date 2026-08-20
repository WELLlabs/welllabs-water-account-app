<script lang="ts">
	import BrandAiMark from '$lib/components/BrandAiMark.svelte';
</script>

<svelte:head>
	<title>Contact Us · AI @ WELL Labs</title>
</svelte:head>

<div class="page">
	<header class="bar">
		<div class="bar-inner">
			<a href="/" class="brand-link" aria-label="AI @ WELL Labs home">
				<BrandAiMark heightRem={2.4} maxWidthPx={260} />
			</a>
			<nav class="bar-nav" aria-label="Primary">
				<a href="/about" class="bar-link">About</a>
				<a href="/contact" class="bar-link bar-link-active" aria-current="page">Contact Us</a>
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
			<h1>Contact Us</h1>
			<p class="lead">
				Contact the WELL Labs team for questions about our open data, digital tools, or the Digital
				Futures initiative.
			</p>
			<p class="reach">
				Reach out to us at
				<a href="mailto:welllabs.platforms@ifmr.ac.in">welllabs.platforms@ifmr.ac.in</a>
			</p>
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
		--panel: #ffffff;
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

	.lead {
		margin: 1.25rem 0 0;
		max-width: 40rem;
		font-size: 1.05rem;
		line-height: 1.65;
		color: var(--ink-soft);
	}

	.reach {
		margin: 1rem 0 0;
		max-width: 40rem;
		font-size: 1.05rem;
		line-height: 1.65;
		color: var(--ink-soft);
	}

	.reach a {
		color: var(--accent);
		font-weight: 600;
		text-decoration: none;
		word-break: break-all;
	}

	.reach a:hover {
		color: var(--ink);
		text-decoration: underline;
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
