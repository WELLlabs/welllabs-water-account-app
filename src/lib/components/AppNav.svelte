<script lang="ts">
	import { page } from '$app/stores';
	import BrandAiMark from '$lib/components/BrandAiMark.svelte';

	const links = [
		{ href: '/fwa', label: 'Home', exact: true },
		{ href: '/fwa/create', label: 'Form Creator', exact: false },
		{ href: '/fwa/visualize', label: 'Visualization', exact: false },
		{ href: '/fwa/calculate', label: 'Crop Calc', exact: false },
		{ href: '/fwa/supply', label: 'Supply', exact: false }
	];

	function isActive(href: string, exact: boolean): boolean {
		const path = $page.url.pathname.replace(/\/$/, '') || '/';
		const target = href.replace(/\/$/, '') || '/';
		if (exact) return path === target;
		return path === target || path.startsWith(target + '/');
	}
</script>

<nav class="border-b border-[color-mix(in_srgb,#00296b_12%,white)] bg-white">
	<div class="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-3">
		<BrandAiMark heightRem={2} maxWidthPx={180} />
		<div class="flex flex-wrap gap-1">
			{#each links as link}
				<a
					href={link.href}
					class="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors {isActive(
						link.href,
						link.exact
					)
						? 'bg-[#1b75e0] text-white'
						: 'text-[#00296b]/80 hover:bg-[#1b75e0]/10 hover:text-[#00296b]'}"
					style="font-family: 'Montserrat', sans-serif"
				>
					{link.label}
				</a>
			{/each}
		</div>
	</div>
</nav>
