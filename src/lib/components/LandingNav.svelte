<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/stores';
	import BrandAiMark from '$lib/components/BrandAiMark.svelte';

	let menuOpen = $state(false);

	const path = $derived(($page.url.pathname.replace(/\/$/, '') || '/') as string);

	function isActive(href: string): boolean {
		return path === href || path.startsWith(href + '/');
	}

	function closeMenu() {
		menuOpen = false;
	}

	function toggleMenu() {
		menuOpen = !menuOpen;
	}

	afterNavigate(closeMenu);
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') closeMenu();
	}}
/>

<header class="bar">
	<div class="bar-inner">
		<div class="brand-wrap">
			<BrandAiMark heightRem={2.15} maxWidthPx={200} ariaLabel="AI @ WELL Labs — Home" />
		</div>

		<button
			type="button"
			class="menu-toggle"
			aria-expanded={menuOpen}
			aria-controls="landing-nav-menu"
			aria-label={menuOpen ? 'Close menu' : 'Open menu'}
			onclick={toggleMenu}
		>
			{#if menuOpen}
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
					<path stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
				</svg>
			{:else}
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
					<path stroke-linecap="round" d="M4 7h16M4 12h16M4 17h16" />
				</svg>
			{/if}
		</button>

		<nav
			id="landing-nav-menu"
			class="bar-nav"
			class:open={menuOpen}
			aria-label="Primary"
		>
			<a href="/about" class="bar-link" class:active={isActive('/about')} onclick={closeMenu}>
				About
			</a>
			<a href="/contact" class="bar-link" class:active={isActive('/contact')} onclick={closeMenu}>
				Contact Us
			</a>
			<a
				href="https://welllabs.org"
				target="_blank"
				rel="noopener noreferrer"
				class="bar-cta"
				onclick={closeMenu}
			>
				WELL Labs Website
			</a>
		</nav>
	</div>
</header>

{#if menuOpen}
	<button type="button" class="menu-backdrop" aria-label="Close menu" onclick={closeMenu}></button>
{/if}

<style>
	.bar {
		position: sticky;
		top: 0;
		z-index: 40;
		border-bottom: 1px solid color-mix(in srgb, #00296b 14%, white);
		background: color-mix(in srgb, #f4f7fb 88%, white);
		backdrop-filter: blur(10px);
	}

	.bar-inner {
		width: min(1100px, calc(100% - 2rem));
		margin-inline: auto;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.75rem 0;
		position: relative;
	}

	.brand-wrap {
		min-width: 0;
		max-width: min(200px, 58vw);
		overflow: hidden;
	}

	.brand-wrap :global(.brand-ai-mark) {
		max-width: 100%;
	}

	.menu-toggle {
		display: none;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		flex-shrink: 0;
		border: 1px solid color-mix(in srgb, #00296b 14%, white);
		border-radius: 0;
		background: white;
		color: #00296b;
		cursor: pointer;
	}

	.menu-toggle svg {
		width: 1.25rem;
		height: 1.25rem;
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
		color: color-mix(in srgb, #00296b 78%, white);
		text-decoration: none;
		transition: color 160ms ease;
		font-family: 'Montserrat', sans-serif;
	}

	.bar-link:hover,
	.bar-link.active {
		color: #1b75e0;
	}

	.bar-cta {
		border-radius: 999px;
		background: #1b75e0;
		color: white;
		padding: 0.55rem 1rem;
		font-size: 0.85rem;
		font-weight: 600;
		text-decoration: none;
		transition: background 160ms ease;
		font-family: 'Montserrat', sans-serif;
		white-space: nowrap;
	}

	.bar-cta:hover {
		background: #00296b;
	}

	.menu-backdrop {
		display: none;
	}

	@media (max-width: 720px) {
		.menu-toggle {
			display: grid;
		}

		.bar-nav {
			display: none;
			position: absolute;
			top: calc(100% + 1px);
			left: 0;
			right: 0;
			flex-direction: column;
			align-items: stretch;
			gap: 0.25rem;
			padding: 0.75rem;
			border: 1px solid color-mix(in srgb, #00296b 14%, white);
			border-top: none;
			background: white;
			box-shadow: 0 12px 28px color-mix(in srgb, #00296b 14%, transparent);
			z-index: 41;
		}

		.bar-nav.open {
			display: flex;
		}

		.bar-link {
			padding: 0.85rem 0.75rem;
			font-size: 1rem;
		}

		.bar-cta {
			margin-top: 0.35rem;
			text-align: center;
			padding: 0.85rem 1rem;
		}

		.menu-backdrop {
			display: block;
			position: fixed;
			inset: 0;
			z-index: 30;
			border: 0;
			background: color-mix(in srgb, #00296b 28%, transparent);
			cursor: pointer;
		}
	}
</style>
