<script lang="ts">
	import LandingNav from '$lib/components/LandingNav.svelte';
</script>

<svelte:head>
	<title>About · AI @ WELL Labs</title>
</svelte:head>

<div class="page">
	<LandingNav />

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

	@media (max-width: 720px) {
		.main {
			padding: 2.25rem 0 3rem;
		}

		.prose p {
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
