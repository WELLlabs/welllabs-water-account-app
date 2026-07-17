<script lang="ts">
	import '../app.css';
	import AppNav from '$lib/components/AppNav.svelte';

	let { children } = $props();
</script>

<AppNav />
{@render children()}
