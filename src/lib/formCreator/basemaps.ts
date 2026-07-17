export interface BuiltinBasemap {
	id: string;
	label: string;
	category: 'streets' | 'satellite' | 'humanitarian' | 'topo';
	/** Leaflet XYZ URL with {z}/{x}/{y} placeholders */
	leafletUrl: string;
	/** QGIS datasource string (wms provider) */
	qgsDatasource: string;
	attribution: string;
	requiresInternet: true;
	maxZoom: number;
}

export interface OfflineBasemap {
	id: string;
	label: string;
	type: 'mbtiles' | 'geotiff';
	file: File;
	requiresInternet: false;
}

export type AnyBasemap = BuiltinBasemap | OfflineBasemap;

export const BUILTIN_BASEMAPS: BuiltinBasemap[] = [
	{
		id: 'osm',
		label: 'OpenStreetMap',
		category: 'streets',
		leafletUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
		qgsDatasource:
			'type=xyz&url=https://tile.openstreetmap.org/{z}/{x}/{y}.png&zmax=19&zmin=0',
		attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
		requiresInternet: true,
		maxZoom: 19
	},
	{
		id: 'esri-imagery',
		label: 'ESRI World Imagery',
		category: 'satellite',
		leafletUrl:
			'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
		qgsDatasource:
			'type=xyz&url=https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}&zmax=19&zmin=0',
		attribution:
			'Tiles © Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
		requiresInternet: true,
		maxZoom: 19
	}
];

export const CATEGORY_LABELS: Record<BuiltinBasemap['category'], string> = {
	streets: 'Streets',
	humanitarian: 'Humanitarian',
	topo: 'Topographic',
	satellite: 'Satellite'
};

export const CATEGORY_ORDER: BuiltinBasemap['category'][] = ['streets', 'satellite'];

/** Returns the QGS datasource + provider for a given AnyBasemap */
export function basemapQgsInfo(bm: AnyBasemap): { datasource: string; provider: string } {
	if (bm.requiresInternet) {
		return { datasource: bm.qgsDatasource, provider: 'wms' };
	}
	// MBTiles/GeoTIFF bundled in the QGZ must use attachment: so QGIS resolves
	// them against the extracted archive dir (./ looks next to the .qgz on disk).
	return { datasource: `attachment:${bm.file.name}`, provider: 'gdal' };
}
