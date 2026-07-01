import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	optimizeDeps: {
		include: ['@ngageoint/geopackage'],
		esbuildOptions: {
			define: { global: 'globalThis' },
			external: ['better-sqlite3']
		}
	},
	worker: {
		format: 'es'
	}
});
