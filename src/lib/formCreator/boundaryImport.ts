import { GeoPackage, GeoPackageAPI } from '@ngageoint/geopackage';

export async function readGpkgBoundaries(buffer: ArrayBuffer): Promise<GeoJSON.FeatureCollection> {
	const geoPackage = await GeoPackageAPI.open(new Uint8Array(buffer));
	try {
		const tableNames = geoPackage.getFeatureTables();
		if (tableNames.length === 0) {
			throw new Error('No feature tables found in GeoPackage.');
		}

		const featureDao = geoPackage.getFeatureDao(tableNames[0]);
		const srs = featureDao.srs;
		const features: GeoJSON.Feature[] = [];

		for (const row of featureDao.queryForEach()) {
			if (!row) continue;
			const featureRow = featureDao.getRow(row);
			const geoJsonFeature = GeoPackage.parseFeatureRowIntoGeoJSON(featureRow, srs);
			if (geoJsonFeature.geometry) {
				features.push(geoJsonFeature);
			}
		}

		return { type: 'FeatureCollection', features };
	} finally {
		geoPackage.close();
	}
}
