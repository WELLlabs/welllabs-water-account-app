import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		proxy: {
			'/fwa-api': {
				target: 'http://127.0.0.1:8010',
				changeOrigin: true
			}
		}
	},
	optimizeDeps: {
		include: ['@ngageoint/geopackage', 'sql.js'],
		esbuildOptions: {
			define: { global: 'globalThis' }
		}
	},
	worker: {
		format: 'es'
	}
});
