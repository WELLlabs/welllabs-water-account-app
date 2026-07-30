<script lang="ts">
	import AppNav from '$lib/components/AppNav.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<title>Farm Water Accounting</title>
</svelte:head>

<AppNav />
{@render children()}
