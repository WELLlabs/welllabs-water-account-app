import turfArea from '@turf/area';
import type { ColumnConfig } from './types';

/** Reserved internal names that users cannot use as ID/area column names */
const RESERVED_NAMES = new Set(['fid', 'geom', 'geometry', 'the_geom']);

/**
 * Extract all property columns from a FeatureCollection.
 * Skips geometry-related keys and computes sample values.
 */
export function extractColumns(fc: GeoJSON.FeatureCollection): ColumnConfig[] {
	const keySet = new Set<string>();
	// Collect all property keys across features
	for (const f of fc.features) {
		if (f.properties) {
			for (const k of Object.keys(f.properties)) {
				if (!RESERVED_NAMES.has(k.toLowerCase())) keySet.add(k);
			}
		}
	}

	return Array.from(keySet).map((name) => {
		// Find first non-null value as a sample
		let sample = '';
		for (const f of fc.features) {
			const v = f.properties?.[name];
			if (v !== null && v !== undefined && String(v).trim() !== '') {
				sample = String(v);
				break;
			}
		}
		return { name, sample, keep: true, locked: false, role: 'none' as const };
	});
}

/**
 * Generate plot IDs in format P-001, P-002 … P-NNN (zero-padded based on total count).
 * Mutates the features' properties in place and returns the column name used.
 */
export function generatePlotIds(fc: GeoJSON.FeatureCollection): string {
	const colName = 'plot_id';
	const digits = String(fc.features.length).length;
	fc.features.forEach((f, i) => {
		if (!f.properties) f.properties = {};
		f.properties[colName] = `P-${String(i + 1).padStart(digits, '0')}`;
	});
	return colName;
}

/**
 * Generate area values in acres for each polygon feature.
 * Mutates the features' properties in place and returns the column name used.
 */
export function generateAreaAcres(fc: GeoJSON.FeatureCollection): string {
	const colName = 'area_acres';
	const SQ_M_TO_ACRES = 0.000247105;
	for (const f of fc.features) {
		if (!f.properties) f.properties = {};
		try {
			const sqm = turfArea(f as GeoJSON.Feature);
			f.properties[colName] = Math.round(sqm * SQ_M_TO_ACRES * 10000) / 10000; // 4 decimal places
		} catch {
			f.properties[colName] = null;
		}
	}
	return colName;
}

/**
 * Assign an existing column as the ID column (locks it, marks role='id').
 * Returns updated columns array.
 */
export function assignIdColumn(columns: ColumnConfig[], name: string): ColumnConfig[] {
	return columns.map((c) => ({
		...c,
		role: c.name === name ? ('id' as const) : c.role === 'id' ? ('none' as const) : c.role,
		locked: c.name === name ? true : c.role === 'id' ? false : c.locked,
		keep: c.name === name ? true : c.keep
	}));
}

/**
 * Assign an existing column as the area column (locks it, marks role='area').
 * Returns updated columns array.
 */
export function assignAreaColumn(columns: ColumnConfig[], name: string): ColumnConfig[] {
	return columns.map((c) => ({
		...c,
		role: c.name === name ? ('area' as const) : c.role === 'area' ? ('none' as const) : c.role,
		locked: c.name === name ? true : c.role === 'area' ? false : c.locked,
		keep: c.name === name ? true : c.keep
	}));
}

/** Add a generated column to the columns list (locked, with given role). */
export function addGeneratedColumn(
	columns: ColumnConfig[],
	name: string,
	role: 'id' | 'area',
	sample: string
): ColumnConfig[] {
	// Remove any previous generated column with same role
	const cleared = columns.map((c) => ({
		...c,
		role: c.role === role ? ('none' as const) : c.role,
		locked: c.role === role ? false : c.locked
	}));
	// Remove if name already exists (from a previous generate)
	const deduped = cleared.filter((c) => c.name !== name);
	return [
		...deduped,
		{ name, sample, keep: true, locked: true, role }
	];
}
