import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
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
