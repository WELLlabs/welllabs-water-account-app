import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
            // Change 'build' to your desired folder name
            pages: 'build',
            assets: 'build',
            fallback: 'index.html' 
        })
	}
};

export default config;
