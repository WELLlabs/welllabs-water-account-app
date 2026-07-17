declare module 'shpjs' {
	type ShpResult = GeoJSON.FeatureCollection | GeoJSON.FeatureCollection[];

	interface ShpObject {
		shp: ArrayBuffer | Uint8Array;
		dbf?: ArrayBuffer | Uint8Array;
		prj?: string | ArrayBuffer | Uint8Array;
		cpg?: string | ArrayBuffer | Uint8Array;
	}

	function shp(input: string | ArrayBuffer | Uint8Array | ShpObject): Promise<ShpResult>;

	export default shp;
	export function parseZip(buffer: ArrayBuffer | Uint8Array): Promise<ShpResult>;
	export function parseShp(
		shp: ArrayBuffer | Uint8Array,
		prj?: string | ArrayBuffer
	): GeoJSON.Feature[];
	export function parseDbf(
		dbf: ArrayBuffer | Uint8Array,
		cpg?: string | ArrayBuffer
	): Record<string, unknown>[];
	export function combine(
		arr: [GeoJSON.Feature[], Record<string, unknown>[]]
	): GeoJSON.FeatureCollection;
}
