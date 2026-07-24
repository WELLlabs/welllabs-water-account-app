import JSZip from 'jszip';
import { downloadBlob } from '$lib/exportUtils';
import type { FormProjectConfig, ColumnConfig } from './types';
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

/** Stay under nginx's default 1m even when deploy hasn't raised the limit. */
const CHUNK_SIZE = 256 * 1024;

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

/** Round coordinates so GeoJSON compresses well (~0.1 m at equator). */
function roundCoord(n: number): number {
	return Math.round(n * 1e6) / 1e6;
}

function quantizePosition(pos: GeoJSON.Position): GeoJSON.Position {
	const out: number[] = [];
	for (let i = 0; i < pos.length; i++) {
		out.push(i < 2 ? roundCoord(pos[i] as number) : (pos[i] as number));
	}
	return out;
}

function quantizeGeometry(geom: GeoJSON.Geometry | null): GeoJSON.Geometry | null {
	if (!geom) return null;
	switch (geom.type) {
		case 'Point':
			return { type: 'Point', coordinates: quantizePosition(geom.coordinates) };
		case 'MultiPoint':
		case 'LineString':
			return {
				type: geom.type,
				coordinates: geom.coordinates.map(quantizePosition)
			};
		case 'MultiLineString':
		case 'Polygon':
			return {
				type: geom.type,
				coordinates: geom.coordinates.map((ring) => ring.map(quantizePosition))
			};
		case 'MultiPolygon':
			return {
				type: 'MultiPolygon',
				coordinates: geom.coordinates.map((poly) =>
					poly.map((ring) => ring.map(quantizePosition))
				)
			};
		case 'GeometryCollection':
			return {
				type: 'GeometryCollection',
				geometries: geom.geometries
					.map((g) => quantizeGeometry(g))
					.filter((g): g is GeoJSON.Geometry => g != null)
			};
		default:
			return geom;
	}
}

function compactBoundaries(
	fc: GeoJSON.FeatureCollection,
	keptColumns: ColumnConfig[]
): GeoJSON.FeatureCollection {
	const keepNames = keptColumns.filter((c) => c.keep).map((c) => c.name);
	const features: GeoJSON.Feature[] = [];
	for (const feat of fc.features) {
		const geom = quantizeGeometry(feat.geometry);
		if (!geom) continue;
		const src = (feat.properties || {}) as Record<string, unknown>;
		const props: Record<string, unknown> = {};
		for (const name of keepNames) {
			if (name in src) props[name] = src[name];
		}
		features.push({
			type: 'Feature',
			geometry: geom,
			properties: props
		});
	}
	return { type: 'FeatureCollection', features };
}

export function serializeConfig(config: FormProjectConfig): SerializableFormConfig {
	return {
		projectName: config.projectName,
		tableName: config.tableName,
		fields: config.fields,
		ficMappings: config.ficMappings,
		boundaries: compactBoundaries(config.boundaries, config.keptColumns),
		keptColumns: config.keptColumns,
		basemaps: config.basemaps.map(serializeBasemap)
	};
}

async function gzipBytes(data: Uint8Array): Promise<Uint8Array> {
	if (typeof CompressionStream === 'undefined') return data;
	const stream = new Blob([data as BlobPart])
		.stream()
		.pipeThrough(new CompressionStream('gzip'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readError(res: Response): Promise<string> {
	let detail = `Export failed (${res.status})`;
	try {
		const body = await res.json();
		if (body?.detail)
			detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
	} catch {
		try {
			const text = await res.text();
			if (text) {
				// nginx 413 HTML is noisy — keep it short
				if (res.status === 413 || /413|Request Entity Too Large/i.test(text)) {
					detail =
						'Upload rejected (413). The server request-size limit is still too small — redeploy the API/nginx fix, or retry (chunked upload should avoid this).';
				} else {
					detail = text.slice(0, 300);
				}
			}
		} catch {
			/* ignore */
		}
	}
	return detail;
}

async function postConfigOnce(payload: Uint8Array, gzipped: boolean): Promise<Blob> {
	const headers: Record<string, string> = {
		'Content-Type': gzipped ? 'application/gzip' : 'application/json'
	};
	if (gzipped) headers['Content-Encoding'] = 'gzip';

	const res = await fetch('/api/generate-qgz', {
		method: 'POST',
		headers,
		body: new Blob([payload as BlobPart])
	});
	if (!res.ok) throw new Error(await readError(res));
	return res.blob();
}

async function postConfigChunked(payload: Uint8Array, gzipped: boolean): Promise<Blob> {
	const initRes = await fetch('/api/generate-qgz/init', { method: 'POST' });
	if (!initRes.ok) throw new Error(await readError(initRes));
	const { upload_id: uploadId } = (await initRes.json()) as { upload_id: string };

	const totalChunks = Math.ceil(payload.byteLength / CHUNK_SIZE);
	for (let i = 0; i < totalChunks; i++) {
		const slice = payload.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
		const chunkRes = await fetch(`/api/generate-qgz/chunk/${uploadId}/${i}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/octet-stream' },
			body: new Blob([slice as BlobPart])
		});
		if (!chunkRes.ok) throw new Error(await readError(chunkRes));
	}

	const completeRes = await fetch(`/api/generate-qgz/complete/${uploadId}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			total_chunks: totalChunks,
			content_encoding: gzipped ? 'gzip' : null
		})
	});
	if (!completeRes.ok) throw new Error(await readError(completeRes));
	return completeRes.blob();
}

/**
 * Ask FastAPI to build data.gpkg + .qgs, then stitch large offline basemaps
 * into the QGZ in the browser.
 *
 * Payload is compacted + gzipped. If still large (or a single POST gets 413),
 * it uploads in ≤512 KiB chunks so nginx's default 1m limit cannot block export.
 */
export async function exportQgzProject(config: FormProjectConfig): Promise<Blob> {
	const serializable = serializeConfig(config);
	const jsonBytes = new TextEncoder().encode(JSON.stringify(serializable));
	const gzippedBytes = await gzipBytes(jsonBytes);
	const useGzip = gzippedBytes.byteLength < jsonBytes.byteLength;
	const payload = useGzip ? gzippedBytes : jsonBytes;

	let baseQgz: Blob;
	try {
		if (payload.byteLength <= CHUNK_SIZE) {
			baseQgz = await postConfigOnce(payload, useGzip);
		} else {
			baseQgz = await postConfigChunked(payload, useGzip);
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		// If a single POST hit a stale 1m nginx limit, fall back to chunks
		if (payload.byteLength <= CHUNK_SIZE && /413|Request Entity Too Large/i.test(msg)) {
			baseQgz = await postConfigChunked(payload, useGzip);
		} else if (/Cannot reach|Failed to fetch|NetworkError/i.test(msg)) {
			throw new Error(
				'Cannot reach the QGZ API. Run `npm run dev` (starts UI + FastAPI) or `npm run setup:api` once, then `npm run dev:api`.'
			);
		} else {
			throw err instanceof Error ? err : new Error(msg);
		}
	}

	const offlineBasemaps = config.basemaps.filter((bm) => !bm.requiresInternet) as OfflineBasemap[];
	if (offlineBasemaps.length === 0) {
		return baseQgz;
	}

	const zip = await JSZip.loadAsync(baseQgz);
	for (const bm of offlineBasemaps) {
		const bytes = new Uint8Array(await bm.file.arrayBuffer());
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
