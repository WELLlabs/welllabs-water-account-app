import shp from 'shpjs';
import { getGeoJsonColumnNames } from './gpkgParser';
import { normalizeSowingDateInput, parseDbfDateFieldRaw } from './waterBudget';

const SHAPE_EXTS = new Set(['shp', 'shx', 'dbf', 'prj', 'cpg', 'qmd', 'sbn', 'sbx', 'xml', 'qpj']);

export interface ShapefileLoadResult {
	featureCollection: GeoJSON.FeatureCollection;
	columns: string[];
	tableName: string;
	displayName: string;
}

function baseName(path: string): string {
	const name = path.split(/[/\\]/).pop() ?? path;
	return name.replace(/\.[^.]+$/, '');
}

function extOf(path: string): string {
	const name = path.split(/[/\\]/).pop() ?? path;
	const i = name.lastIndexOf('.');
	return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

function sanitizeTableName(name: string): string {
	const cleaned = name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+/, '');
	return cleaned || 'farm_plots';
}

function asFeatureCollection(
	result: GeoJSON.FeatureCollection | GeoJSON.FeatureCollection[]
): GeoJSON.FeatureCollection {
	if (Array.isArray(result)) {
		return {
			type: 'FeatureCollection',
			features: result.flatMap((fc) => fc.features ?? [])
		};
	}
	return result;
}

/** True if this FileList/File looks like shapefile components (not a lone .gpkg). */
export function looksLikeShapefileInput(files: File[]): boolean {
	if (files.length === 0) return false;
	if (files.length === 1) {
		const n = files[0].name.toLowerCase();
		return n.endsWith('.zip') || n.endsWith('.shp');
	}
	return files.some((f) => {
		const e = extOf(f.webkitRelativePath || f.name);
		return e === 'shp' || e === 'dbf' || e === 'prj' || e === 'cpg' || e === 'qmd';
	});
}

/**
 * Collect files from a dropped folder (or mixed FileList) via the File System API.
 * Falls back to `dataTransfer.files` when directory entries are unavailable.
 */
export async function collectDroppedFiles(dataTransfer: DataTransfer): Promise<File[]> {
	const items = dataTransfer.items;
	if (!items?.length) {
		return Array.from(dataTransfer.files ?? []);
	}

	const files: File[] = [];

	async function walkEntry(entry: FileSystemEntry): Promise<void> {
		if (entry.isFile) {
			const file = await new Promise<File>((resolve, reject) => {
				(entry as FileSystemFileEntry).file(resolve, reject);
			});
			files.push(file);
			return;
		}
		if (entry.isDirectory) {
			const reader = (entry as FileSystemDirectoryEntry).createReader();
			const readBatch = (): Promise<FileSystemEntry[]> =>
				new Promise((resolve, reject) => reader.readEntries(resolve, reject));
			let batch = await readBatch();
			while (batch.length > 0) {
				for (const child of batch) await walkEntry(child);
				batch = await readBatch();
			}
		}
	}

	const entries: FileSystemEntry[] = [];
	for (let i = 0; i < items.length; i++) {
		const entry = items[i].webkitGetAsEntry?.();
		if (entry) entries.push(entry);
	}

	if (entries.length === 0) {
		return Array.from(dataTransfer.files ?? []);
	}

	for (const entry of entries) {
		await walkEntry(entry);
	}
	return files;
}

type ShpInput = {
	shp: ArrayBuffer;
	dbf?: ArrayBuffer;
	prj?: string | ArrayBuffer;
	cpg?: string | ArrayBuffer;
};

interface DbfField {
	name: string;
	type: string;
	len: number;
	offset: number;
}

function parseDbfFields(buf: Buffer | Uint8Array): {
	fields: DbfField[];
	headerLen: number;
	recordLen: number;
	numRecords: number;
} {
	const view = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
	const dv = new DataView(view.buffer, view.byteOffset, view.byteLength);
	const numRecords = dv.getUint32(4, true);
	const headerLen = dv.getUint16(8, true);
	const recordLen = dv.getUint16(10, true);

	const fields: DbfField[] = [];
	let offset = 32;
	let recordOffset = 1; // skip delete flag
	while (view[offset] !== 0x0d && offset + 32 <= headerLen) {
		const nameBytes = view.subarray(offset, offset + 11);
		let name = '';
		for (let i = 0; i < nameBytes.length && nameBytes[i] !== 0; i++) {
			name += String.fromCharCode(nameBytes[i]);
		}
		name = name.trim();
		const type = String.fromCharCode(view[offset + 11]);
		const len = view[offset + 16];
		fields.push({ name, type, len, offset: recordOffset });
		recordOffset += len;
		offset += 32;
	}

	return { fields, headerLen, recordLen, numRecords };
}

function readDbfFieldString(
	view: Uint8Array,
	headerLen: number,
	recordLen: number,
	recordIndex: number,
	field: DbfField
): string {
	const start = headerLen + recordIndex * recordLen + field.offset;
	const bytes = view.subarray(start, start + field.len);
	let s = '';
	for (let i = 0; i < bytes.length; i++) {
		if (bytes[i] === 0) break;
		s += String.fromCharCode(bytes[i]);
	}
	return s;
}

function inferReferenceYear(fc: GeoJSON.FeatureCollection): number | undefined {
	const years: number[] = [];
	for (const f of fc.features) {
		const props = f.properties ?? {};
		for (const [key, val] of Object.entries(props)) {
			if (!/survey/i.test(key)) continue;
			const normalized = normalizeSowingDateInput(val);
			if (normalized) {
				years.push(Number(normalized.slice(0, 4)));
				continue;
			}
			const m = String(val ?? '').match(/\b(20\d{2})\b/);
			if (m) years.push(Number(m[1]));
		}
	}
	if (years.length === 0) return undefined;
	// Mode
	const counts = new Map<number, number>();
	for (const y of years) counts.set(y, (counts.get(y) ?? 0) + 1);
	let best = years[0];
	let bestCount = 0;
	for (const [y, c] of counts) {
		if (c > bestCount) {
			best = y;
			bestCount = c;
		}
	}
	return best;
}

/**
 * shpjs parses DBF type-D fields as YYYYMMDD. Many QField/QGIS exports instead
 * store space-padded dd/mm/yy digits in those 8 bytes. Re-read raw values and
 * overwrite feature properties with normalized YYYY-MM-DD strings.
 */
function fixDbfDateFields(
	fc: GeoJSON.FeatureCollection,
	dbfBuffer: ArrayBuffer,
	referenceYear?: number
): void {
	const view = new Uint8Array(dbfBuffer);
	const { fields, headerLen, recordLen, numRecords } = parseDbfFields(view);
	const dateFields = fields.filter((f) => f.type === 'D');
	if (dateFields.length === 0) return;

	const n = Math.min(numRecords, fc.features.length);
	for (let i = 0; i < n; i++) {
		const props = fc.features[i].properties;
		if (!props) continue;
		for (const field of dateFields) {
			const raw = readDbfFieldString(view, headerLen, recordLen, i, field);
			const iso = parseDbfDateFieldRaw(raw, referenceYear);
			props[field.name] = iso || null;
		}
	}
}

async function finalizeShapefile(
	fc: GeoJSON.FeatureCollection,
	dbfBuffer: ArrayBuffer | undefined,
	tableName: string,
	displayName: string
): Promise<ShapefileLoadResult> {
	if (!fc.features?.length) {
		throw new Error('No features could be read from the shapefile.');
	}

	const referenceYear = inferReferenceYear(fc);
	if (dbfBuffer) {
		fixDbfDateFields(fc, dbfBuffer, referenceYear);
	}

	return {
		featureCollection: fc,
		columns: getGeoJsonColumnNames(fc),
		tableName,
		displayName
	};
}

/**
 * Load a shapefile from loose components (.shp/.dbf/.prj/.cpg/.qmd…), a folder of them, or a .zip.
 */
export async function loadShapefileFromFiles(files: File[]): Promise<ShapefileLoadResult> {
	if (files.length === 0) {
		throw new Error('No files provided.');
	}

	// Single zip — shpjs handles unzip; date fix needs a separate dbf if we can extract later.
	// For zips we rely on normalizeSowingDateInput after properties are set; prefer folder upload
	// for dd/mm/yy Date fields. Still run shp and return.
	if (files.length === 1 && files[0].name.toLowerCase().endsWith('.zip')) {
		const buffer = await files[0].arrayBuffer();
		const fc = asFeatureCollection(await shp(buffer));
		const name = baseName(files[0].name);
		// Zip path: try to recover date strings already on features via normalize (limited)
		const referenceYear = inferReferenceYear(fc);
		for (const f of fc.features) {
			if (!f.properties) continue;
			for (const [k, v] of Object.entries(f.properties)) {
				if (!(v instanceof Date) && typeof v !== 'string') continue;
				if (!/date|sow/i.test(k)) continue;
				if (v instanceof Date && (v.getFullYear() < 1980 || v.getFullYear() > 2100)) {
					f.properties[k] = null;
				} else if (typeof v === 'string') {
					const iso = normalizeSowingDateInput(v) || parseDbfDateFieldRaw(v, referenceYear);
					if (iso) f.properties[k] = iso;
				}
			}
		}
		return {
			featureCollection: fc,
			columns: getGeoJsonColumnNames(fc),
			tableName: sanitizeTableName(name),
			displayName: files[0].name
		};
	}

	const groups = new Map<
		string,
		{ shp?: File; dbf?: File; prj?: File; cpg?: File; others: File[] }
	>();

	for (const file of files) {
		const path = file.webkitRelativePath || file.name;
		const ext = extOf(path);
		if (!SHAPE_EXTS.has(ext) && ext !== 'zip') continue;
		if (ext === 'zip') continue;

		const key = baseName(path).toLowerCase();
		let group = groups.get(key);
		if (!group) {
			group = { others: [] };
			groups.set(key, group);
		}
		if (ext === 'shp') group.shp = file;
		else if (ext === 'dbf') group.dbf = file;
		else if (ext === 'prj') group.prj = file;
		else if (ext === 'cpg') group.cpg = file;
		else group.others.push(file);
	}

	const withShp = Array.from(groups.entries()).filter(([, g]) => g.shp);
	if (withShp.length === 0) {
		const hasDbf = files.some((f) => extOf(f.webkitRelativePath || f.name) === 'dbf');
		const hasPrj = files.some((f) => extOf(f.webkitRelativePath || f.name) === 'prj');
		if (hasDbf || hasPrj) {
			throw new Error(
				'Found .dbf/.prj/.cpg/.qmd but no .shp file. Include the matching .shp (and preferably .shx) in the folder.'
			);
		}
		throw new Error(
			'No shapefile found. Drop a folder with .shp + .dbf (+ .prj/.cpg/.qmd), a .zip, or a .gpkg.'
		);
	}

	withShp.sort((a, b) => {
		const score = (g: (typeof withShp)[0][1]) =>
			(g.dbf ? 1 : 0) + (g.prj ? 1 : 0) + (g.cpg ? 1 : 0);
		return score(b[1]) - score(a[1]);
	});

	const [base, group] = withShp[0];
	if (!group.shp) throw new Error('Missing .shp file.');

	const input: ShpInput = {
		shp: await group.shp.arrayBuffer()
	};
	const dbfBuffer = group.dbf ? await group.dbf.arrayBuffer() : undefined;
	if (dbfBuffer) input.dbf = dbfBuffer;
	if (group.prj) input.prj = await group.prj.text();
	if (group.cpg) input.cpg = await group.cpg.text();

	const fc = asFeatureCollection(await shp(input));
	const folderHint = files[0].webkitRelativePath?.split('/')[0] || group.shp.name;

	return finalizeShapefile(
		fc,
		dbfBuffer,
		sanitizeTableName(base),
		folderHint.includes('.') ? folderHint : `${folderHint}/ (${group.shp.name})`
	);
}
