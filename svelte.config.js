import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// adapter-static: produces a fully pre-rendered static site in /build
		// Compatible with ssr = false (client-side only SPA)
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: 'index.html',  // SPA fallback — all routes served from index.html
			precompress: true        // pre-gzip + pre-brotli for Nginx static serving
		})
	}
};

export default config;
