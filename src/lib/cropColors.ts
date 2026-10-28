/** One crop colour language for crop survey, Google ALU, and water-budget plots. */

function key(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/[_-]+/g, ' ')
		.replace(/[()]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Canonical English names and Google ALU codes fold onto the same swatch. */
const COLOR: Record<string, string> = {
	cotton: '#db2777',
	paddy: '#2563eb',
	rice: '#2563eb',
	'tur': '#b45309',
	'red gram': '#b45309',
	'red gram tur': '#b45309',
	jowar: '#92400e',
	sorghum: '#92400e',
	'jowar sorghum': '#92400e',
	sunflower: '#facc15',
	chilli: '#dc2626',
	chili: '#dc2626',
	'chilli dry': '#dc2626',
	'chilli green': '#ef4444',
	bajra: '#ca8a04',
	'pearl millet': '#ca8a04',
	'bajra pearl millet': '#ca8a04',
	maize: '#f59e0b',
	corn: '#f59e0b',
	groundnut: '#65a30d',
	peanut: '#65a30d',
	gram: '#4d7c0f',
	chana: '#4d7c0f',
	'bengal gram': '#4d7c0f',
	'bengal gram chana': '#4d7c0f',
	'green gram': '#16a34a',
	moong: '#16a34a',
	'green gram moong': '#16a34a',
	sugarcane: '#0d9488',
	wheat: '#eab308',
	fallow: '#d6d3d1',
	harvested: '#e7e5e4',
	'not recorded': '#f1f5f9',
	'non agricultural': '#a8a29e',
	'unknown crop': '#7dd3fc',
	unknown: '#7dd3fc',
	'no prediction': '#94a3b8'
};

const SPARE = [
	'#7c3aed',
	'#0891b2',
	'#be185d',
	'#0f766e',
	'#9333ea',
	'#c2410c',
	'#475569',
	'#0369a1',
	'#a21caf',
	'#15803d'
];

export function cropFill(name: string): string {
	const k = key(name);
	if (COLOR[k]) return COLOR[k];
	let h = 0;
	for (const c of k) h = (h * 31 + c.charCodeAt(0)) >>> 0;
	return SPARE[h % SPARE.length];
}

/** Fixed key used on the map before a cell’s crops are loaded. */
export const CROP_SWATCHES: { label: string; color: string }[] = [
	{ label: 'Cotton', color: COLOR.cotton },
	{ label: 'Paddy / rice', color: COLOR.paddy },
	{ label: 'Red gram (tur)', color: COLOR.tur },
	{ label: 'Jowar / sorghum', color: COLOR.jowar },
	{ label: 'Sunflower', color: COLOR.sunflower },
	{ label: 'Chilli', color: COLOR.chilli },
	{ label: 'Bajra', color: COLOR.bajra },
	{ label: 'Maize / corn', color: COLOR.maize },
	{ label: 'Groundnut', color: COLOR.groundnut },
	{ label: 'Sugarcane', color: COLOR.sugarcane }
];
