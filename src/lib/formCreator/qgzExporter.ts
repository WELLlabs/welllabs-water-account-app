import JSZip from 'jszip';
import { downloadBlob } from '$lib/exportUtils';
import type { FormProjectConfig } from './types';
import type { OfflineBasemap, AnyBasemap } from './basemaps';

/** Serializable basemap entry (no File objects). */
export type SerializableBasemap =
	| {
			id: string;
			label: string;
			requiresInternet: true;
			qgsDatasource: string;
	  }
	| {
			id: string;
			label: string;
			requiresInternet: false;
			type: 'mbtiles' | 'geotiff';
			fileName: string;
	  };

export interface SerializableFormConfig {
	projectName: string;
	tableName: string;
	fields: FormProjectConfig['fields'];
	ficMappings: FormProjectConfig['ficMappings'];
	boundaries: GeoJSON.FeatureCollection;
	keptColumns: FormProjectConfig['keptColumns'];
	basemaps: SerializableBasemap[];
}

function serializeBasemap(bm: AnyBasemap): SerializableBasemap {
	if (bm.requiresInternet) {
		return {
			id: bm.id,
			label: bm.label,
			requiresInternet: true,
			qgsDatasource: bm.qgsDatasource
		};
	}
	const offline = bm as OfflineBasemap;
	return {
		id: offline.id,
		label: offline.label,
		requiresInternet: false,
		type: offline.type,
		fileName: offline.file.name
	};
}

export function serializeConfig(config: FormProjectConfig): SerializableFormConfig {
	return {
		projectName: config.projectName,
		tableName: config.tableName,
		fields: config.fields,
		ficMappings: config.ficMappings,
		boundaries: config.boundaries,
		keptColumns: config.keptColumns,
		basemaps: config.basemaps.map(serializeBasemap)
	};
}

/**
 * Ask FastAPI to build data.gpkg + .qgs, then stitch large offline basemaps
 * into the QGZ in the browser (avoids the 1MB multipart upload limit).
 */
export async function exportQgzProject(config: FormProjectConfig): Promise<Blob> {
	const serializable = serializeConfig(config);
	const form = new FormData();
	form.append('config', JSON.stringify(serializable));

	const res = await fetch('/api/generate-qgz', {
		method: 'POST',
		body: form
	}).catch(() => {
		throw new Error(
			'Cannot reach the QGZ API. Run `npm run dev` (starts UI + FastAPI) or `npm run setup:api` once, then `npm run dev:api`.'
		);
	});

	if (!res.ok) {
		let detail = `Export failed (${res.status})`;
		try {
			const body = await res.json();
			if (body?.detail)
				detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
		} catch {
			try {
				detail = await res.text();
			} catch {
				/* ignore */
			}
		}
		throw new Error(detail);
	}

	const baseQgz = await res.blob();
	const offlineBasemaps = config.basemaps.filter((bm) => !bm.requiresInternet) as OfflineBasemap[];
	if (offlineBasemaps.length === 0) {
		return baseQgz;
	}

	const zip = await JSZip.loadAsync(baseQgz);
	for (const bm of offlineBasemaps) {
		const bytes = new Uint8Array(await bm.file.arrayBuffer());
		// STORE large rasters uncompressed — faster and avoids double-compression
		zip.file(bm.file.name, bytes, { compression: 'STORE' });
	}

	return zip.generateAsync({
		type: 'blob',
		compression: 'DEFLATE',
		compressionOptions: { level: 6 }
	});
}

export async function downloadQgz(config: FormProjectConfig): Promise<void> {
	const blob = await exportQgzProject(config);
	const baseName = config.projectName.replace(/[^a-zA-Z0-9_-]/g, '_') || 'farm_survey';
	downloadBlob(blob, `${baseName}.qgz`);
}
