<script lang="ts">
	import { page } from '$app/stores';

	const links = [
		{ href: '/', label: 'Home' },
		{ href: '/create', label: 'Form Creator' },
		{ href: '/visualize', label: 'Visualization' },
		{ href: '/calculate', label: 'Calculator' }
	];
</script>

<nav class="border-b border-slate-200 bg-white">
	<div class="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3">
		<a href="/" class="text-sm font-bold text-slate-900">Farm Water Accounting</a>
		<div class="flex gap-1">
			{#each links as link}
				<a
					href={link.href}
					class="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors {$page.url.pathname ===
					link.href
						? 'bg-blue-600 text-white'
						: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}"
				>
					{link.label}
				</a>
			{/each}
		</div>
	</div>
</nav>
