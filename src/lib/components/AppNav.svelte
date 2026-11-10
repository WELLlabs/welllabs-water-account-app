<script lang="ts">
	import { page } from '$app/stores';
	import { afterNavigate } from '$app/navigation';
	import BrandAiMark from '$lib/components/BrandAiMark.svelte';

	interface NavLink {
		href: string;
		label: string;
	}

	interface NavGroup {
		id: string;
		label: string;
		/** The group's own page, opened by clicking its name */
		href: string;
		links: NavLink[];
	}

	interface Props {
		/** Which part of the site this nav serves; each shows only its own menu */
		section: 'fwa' | 'explorers';
	}

	let { section }: Props = $props();

	const allGroups: NavGroup[] = [
		{
			id: 'fwa',
			label: 'Farm Water Accounting Tools',
			href: '/fwa',
			links: [
				{ href: '/fwa/create', label: 'Form Creator' },
				{ href: '/fwa/visualize', label: 'Visualization' },
				{ href: '/fwa/calculate', label: 'Crop Calc' },
				{ href: '/fwa/supply', label: 'Supply' },
				{ href: '/fwa/tlab', label: 'T-Lab' }
			]
		},
		{
			id: 'explorers',
			label: 'Data Explorers',
			href: '/explorers',
			links: [{ href: '/explorers/tlab', label: 'Crop water estimation' }]
		}
	];
	const groups = $derived(allGroups.filter((g) => g.id === section));

	let openGroup = $state<string | null>(null);
	let navEl = $state<HTMLElement | null>(null);

	afterNavigate(() => (openGroup = null));

	function isActive(href: string, exact = false): boolean {
		const path = $page.url.pathname.replace(/\/$/, '') || '/';
		const target = href.replace(/\/$/, '') || '/';
		if (exact) return path === target;
		return path === target || path.startsWith(target + '/');
	}

	function onWindowClick(e: MouseEvent) {
		if (openGroup && navEl && !navEl.contains(e.target as Node)) openGroup = null;
	}

	function onWindowKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && openGroup) {
			const id = openGroup;
			openGroup = null;
			navEl?.querySelector<HTMLButtonElement>(`[data-group="${id}"]`)?.focus();
		}
	}

	const linkBase = 'text-sm font-medium transition-colors';
	const idle = 'text-[#00296b]/80 hover:bg-[#1b75e0]/10 hover:text-[#00296b]';
	const on = 'bg-[#1b75e0] text-white';
</script>

<svelte:window onclick={onWindowClick} onkeydown={onWindowKey} />

<nav class="border-b border-[color-mix(in_srgb,#00296b_12%,white)] bg-white" bind:this={navEl}>
	<div class="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-3">
		<BrandAiMark heightRem={2} maxWidthPx={200} ariaLabel="WELL Labs AI — Home" />
		<div class="flex flex-wrap items-center gap-1" style="font-family: 'Montserrat', sans-serif">
			<!-- Data Explorers pages go home through the logo only -->
			{#if section !== 'explorers'}
				<a href="/" class="rounded-lg px-3 py-1.5 {linkBase} {isActive('/', true) ? on : idle}">Home</a>
			{/if}

			{#each groups as group, gi (group.id)}
				{@const active = isActive(group.href)}
				{@const open = openGroup === group.id}
				<div class="relative flex items-center">
					<a
						href={group.href}
						aria-current={isActive(group.href, true) ? 'page' : undefined}
						class="rounded-l-lg py-1.5 pr-1.5 pl-3 {linkBase} {active ? on : idle}"
					>
						{group.label}
					</a>
					<button
						type="button"
						data-group={group.id}
						aria-haspopup="true"
						aria-expanded={open}
						aria-controls="nav-menu-{group.id}"
						aria-label="{open ? 'Close' : 'Open'} {group.label} menu"
						onclick={() => (openGroup = open ? null : group.id)}
						class="self-stretch rounded-r-lg px-1.5 {linkBase} {active
							? on
							: open
								? 'bg-[#1b75e0]/10 text-[#00296b]'
								: idle}"
					>
						<svg
							class="h-3 w-3 transition-transform {open ? 'rotate-180' : ''}"
							viewBox="0 0 12 12"
							fill="none"
							stroke="currentColor"
							stroke-width="1.8"
							aria-hidden="true"
						>
							<path d="M3 4.5l3 3 3-3" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					</button>
					{#if open}
						<div
							id="nav-menu-{group.id}"
							class="absolute top-full z-[1100] mt-1 min-w-[12rem] rounded-lg border border-[color-mix(in_srgb,#00296b_12%,white)] bg-white p-1 shadow-lg {gi ===
							groups.length - 1
								? 'right-0'
								: 'left-0'}"
						>
							{#each group.links as link (link.href)}
								{@const current = isActive(link.href)}
								<a
									href={link.href}
									aria-current={current ? 'page' : undefined}
									class="block rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors {current
										? 'bg-[#1b75e0]/10 font-semibold text-[#1b75e0]'
										: 'text-[#00296b]/85 hover:bg-[#1b75e0]/10 hover:text-[#00296b]'}"
								>
									{link.label}
								</a>
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</div>
</nav>
