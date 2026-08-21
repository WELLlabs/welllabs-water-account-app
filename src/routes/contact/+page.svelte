<script lang="ts">
	import LandingNav from '$lib/components/LandingNav.svelte';
</script>

<svelte:head>
	<title>Contact Us · AI @ WELL Labs</title>
</svelte:head>

<div class="page">
	<LandingNav />

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
		--line: color-mix(in srgb, #00296b 14%, white);
		--accent: #1b75e0;
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		background: var(--paper);
		color: var(--ink);
		font-family: 'Montserrat', sans-serif;
	}

	.main-inner,
	.foot-inner {
		width: min(1100px, calc(100% - 2rem));
		margin-inline: auto;
	}

	.main {
		flex: 1;
		padding: 3.5rem 0 4rem;
	}

	.main-inner h1 {
		margin: 0;
		font-family: 'Josefin Sans', sans-serif;
		font-size: clamp(1.85rem, 6vw, 2.75rem);
		font-weight: 700;
		letter-spacing: -0.02em;
	}

	.lead,
	.reach {
		margin: 1.25rem 0 0;
		max-width: 40rem;
		font-size: 1.05rem;
		line-height: 1.65;
		color: var(--ink-soft);
	}

	.reach {
		margin-top: 1rem;
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

	@media (max-width: 720px) {
		.main {
			padding: 2.25rem 0 3rem;
		}

		.lead,
		.reach {
			font-size: 0.98rem;
		}

		.foot-inner {
			flex-direction: column;
			align-items: flex-start;
			gap: 0.5rem;
		}
	}

	@media (max-width: 420px) {
		.main-inner,
		.foot-inner {
			width: min(1100px, calc(100% - 1.25rem));
		}
	}
</style>
