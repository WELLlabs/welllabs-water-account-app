<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import '../app.css';

	let { children } = $props();

	const GA_MEASUREMENT_ID = 'G-XFJ86RWKGG';

	afterNavigate(({ to }) => {
		if (!to || typeof window.gtag !== 'function') return;
		window.gtag('config', GA_MEASUREMENT_ID, {
			page_path: to.url.pathname + to.url.search
		});
	});
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Josefin+Sans:wght@500;600;700&family=Montserrat:wght@400;500;600;700&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

{@render children()}
