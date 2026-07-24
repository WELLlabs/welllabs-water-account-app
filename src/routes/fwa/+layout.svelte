<script lang="ts">
	import AppNav from '$lib/components/AppNav.svelte';

	let { children } = $props();
</script>

<AppNav />
{@render children()}
