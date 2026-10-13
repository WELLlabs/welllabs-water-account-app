// Reads region summary cells (JSON array on stdin) and writes per-cell water need per season
// (JSON on stdout), using the app's own water budget code. Called by build_tlab_water.py.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const cells = JSON.parse(Buffer.concat(chunks).toString('utf8'));

const server = await createServer({ root, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
	const rb = await server.ssrLoadModule('/src/lib/regionBudget.ts');
	const wb = await server.ssrLoadModule('/src/lib/waterBudget.ts');
	const budget = wb.parseWaterBudgetCsv(await readFile(`${root}static/total_water_needed.csv`, 'utf8'));

	const options = rb.summarySeasonOptions(cells);
	const seasons = [];
	const m3 = new Map(cells.map((c) => [c.id, []]));
	for (const opt of options) {
		const summary = rb.summarizeCells(cells, { seasonKey: opt.key, minConfidence: 0, sowingDate: '' }, budget);
		const totals = rb.summaryTotals(summary);
		const peak = totals.peak && totals.peak.m3 > 0 ? totals.peak : null;
		seasons.push({
			key: opt.key,
			plots: opt.plots,
			m3: Math.round(totals.m3),
			peak: peak && { calendarMonth: peak.calendarMonth, calendarYear: peak.calendarYear, m3: Math.round(peak.m3) }
		});
		for (const c of summary.cells) m3.get(c.id).push(Math.round(c.m3));
	}
	process.stdout.write(
		JSON.stringify({
			seasons,
			defaultSeason: rb.defaultSeasonKey(options),
			cells: [...m3].map(([id, values]) => ({ id, m3: values }))
		})
	);
} finally {
	await server.close();
}
