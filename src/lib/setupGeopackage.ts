import { SqljsAdapter } from '@ngageoint/geopackage';

let configured = false;

export function configureGeoPackage(): void {
	if (configured || typeof window === 'undefined') return;

	SqljsAdapter.setSqljsWasmLocateFile((file) => `/sql-wasm.wasm`);
	configured = true;
}
