export interface WaterBudgetRow {
	crop: string;
	/** m³/acre for relative crop months; null = no requirement that month */
	monthM3PerAcre: Array<number | null>;
}

/** Calendar month English name used in schedules / UI */
export type BudgetMonth =
	| 'January'
	| 'February'
	| 'March'
	| 'April'
	| 'May'
	| 'June'
	| 'July'
	| 'August'
	| 'September'
	| 'October'
	| 'November'
	| 'December';

export const BUDGET_MONTHS: BudgetMonth[] = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];

export interface MonthlyWaterNeed {
	month: BudgetMonth;
	/** 1-based month index relative to sowing (month 1 = sowing month) */
	relativeMonth: number;
	calendarMonth: number;
	calendarYear: number;
	waterMmPerAcre: number;
	waterMm: number;
	waterM3PerAcre: number;
	waterM3: number;
}

export type CropSeason = 'Kharif' | 'Rabi';

/** 1 international acre in square metres */
export const ACRE_M2 = 4046.8564224;

/** Convert mm irrigation depth over a given area to volume in m³ */
export function mmDepthToM3(mmDepth: number, acres: number): number {
	return (mmDepth / 1000) * acres * ACRE_M2;
}

/** Convert mm-per-acre budget value to m³ for one acre */
export function mmPerAcreToM3PerAcre(mmPerAcre: number): number {
	return mmDepthToM3(mmPerAcre, 1);
}

const MONTH_NAMES = [
	'january',
	'february',
	'march',
	'april',
	'may',
	'june',
	'july',
	'august',
	'september',
	'october',
	'november',
	'december'
] as const;

export function seasonColumnPrefix(season: string): 'k' | 'r' {
	return season.toLowerCase().startsWith('rabi') ? 'r' : 'k';
}

export function waterColumnName(
	season: string,
	calendarMonth: number,
	calendarYear: number
): string {
	const prefix = seasonColumnPrefix(season);
	const month = MONTH_NAMES[calendarMonth] ?? 'january';
	return `${prefix}_${month}_${calendarYear}`;
}

export function buildWaterColumnValues(
	schedule: WaterSchedule | undefined
): Record<string, number> {
	if (!schedule?.matchedBudget) return {};

	const values: Record<string, number> = {};
	for (const need of getExportableMonthNeeds(schedule)) {
		values[waterColumnName(schedule.season, need.calendarMonth, need.calendarYear)] = round2(
			need.waterM3
		);
	}
	return values;
}

export function collectWaterColumnNames(
	features: Array<{ properties: { waterSchedule?: WaterSchedule } }>
): string[] {
	const names = new Set<string>();
	let maxSowingYear = 0;

	for (const feature of features) {
		const schedule = feature.properties.waterSchedule;
		if (!schedule?.matchedBudget) continue;

		const sowingYear = schedule.sowingDate ? Number(schedule.sowingDate.slice(0, 4)) : 0;
		if (sowingYear > maxSowingYear) maxSowingYear = sowingYear;

		for (const need of getExportableMonthNeeds(schedule)) {
			names.add(waterColumnName(schedule.season, need.calendarMonth, need.calendarYear));
		}
	}

	const filtered =
		maxSowingYear > 0
			? [...names].filter((col) => {
					const year = Number(col.split('_').pop());
					return year >= maxSowingYear;
				})
			: [...names];

	return filtered.sort((a, b) => {
		const parseCol = (col: string) => {
			const parts = col.split('_');
			const year = Number(parts[parts.length - 1]);
			const monthName = parts[parts.length - 2];
			const monthIdx = MONTH_NAMES.indexOf(monthName as (typeof MONTH_NAMES)[number]);
			return year * 100 + (monthIdx >= 0 ? monthIdx : 0);
		};
		return parseCol(a) - parseCol(b);
	});
}

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

export function roundWaterValue(value: number): number {
	return round2(value);
}

const MIN_SOWING_YEAR = 1980;
const MAX_SOWING_YEAR = 2100;

function isPlausibleSowingYear(year: number): boolean {
	return Number.isFinite(year) && year >= MIN_SOWING_YEAR && year <= MAX_SOWING_YEAR;
}

function toLocalDateString(year: number, monthIndex: number, day: number): string | null {
	if (!isPlausibleSowingYear(year)) return null;
	if (monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) return null;
	const date = new Date(year, monthIndex, day);
	if (
		date.getFullYear() !== year ||
		date.getMonth() !== monthIndex ||
		date.getDate() !== day
	) {
		return null;
	}
	const mm = String(monthIndex + 1).padStart(2, '0');
	const dd = String(day).padStart(2, '0');
	return `${year}-${mm}-${dd}`;
}

/** Excel serial day → local calendar date (Excel epoch 1899-12-30). */
function fromExcelSerial(serial: number): string | null {
	if (!Number.isFinite(serial)) return null;
	if (serial < 30000 || serial > 80000) return null;
	const utcMs = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000;
	const d = new Date(utcMs);
	return toLocalDateString(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function fromYyyymmddNumber(n: number): string | null {
	if (!Number.isFinite(n)) return null;
	const raw = Math.trunc(n);
	if (raw < 19800101 || raw > 21001231) return null;
	const year = Math.floor(raw / 10000);
	const month = Math.floor((raw % 10000) / 100);
	const day = raw % 100;
	return toLocalDateString(year, month - 1, day);
}

/**
 * Expand a 2-digit year for farm sowing dates.
 * 00–79 → 2000–2079, 80–99 → 1980–1999 (so 26 → 2026, 95 → 1995).
 */
export function expandTwoDigitYear(yy: number): number {
	if (yy < 0 || yy > 99) return yy;
	return yy >= 80 ? 1900 + yy : 2000 + yy;
}

/**
 * Parse a raw DBF Date (type D, 8 chars) field.
 * Standard values are YYYYMMDD. Many QField exports store space-padded dd/mm/yy
 * digits instead, e.g. "   10710" = 10/7/10, "  110610" = 11/06/10.
 */
export function parseDbfDateFieldRaw(raw: string, referenceYear?: number): string {
	const trimmed = raw.replace(/\0/g, '').trim();
	if (!trimmed || /^0+$/.test(trimmed)) return '';

	if (/^(19|20)\d{6}$/.test(trimmed)) {
		return fromYyyymmddNumber(Number(trimmed)) ?? '';
	}

	if (!/^\d{1,8}$/.test(trimmed)) return '';

	let day: number;
	let month: number;
	let yy: number;

	if (trimmed.length >= 6) {
		const padded = trimmed.padStart(6, '0').slice(-6);
		day = Number(padded.slice(0, 2));
		month = Number(padded.slice(2, 4));
		yy = Number(padded.slice(4, 6));
	} else if (trimmed.length === 5) {
		day = Number(trimmed.slice(0, 1));
		month = Number(trimmed.slice(1, 3));
		yy = Number(trimmed.slice(3, 5));
		if (month < 1 || month > 12) {
			day = Number(trimmed.slice(0, 2));
			month = Number(trimmed.slice(2, 3));
			yy = Number(trimmed.slice(3, 5));
		}
	} else if (trimmed.length === 4) {
		day = Number(trimmed.slice(0, 1));
		month = Number(trimmed.slice(1, 2));
		yy = Number(trimmed.slice(2, 4));
	} else {
		return '';
	}

	let year = expandTwoDigitYear(yy);

	if (
		referenceYear !== undefined &&
		isPlausibleSowingYear(referenceYear) &&
		Math.abs(year - referenceYear) > 3
	) {
		year = referenceYear;
	}

	return toLocalDateString(year, month - 1, day) ?? '';
}

/**
 * Normalize any common sowing-date representation to `YYYY-MM-DD`.
 */
export function normalizeSowingDateInput(value: unknown): string {
	if (value === null || value === undefined || value === '') return '';

	if (value instanceof Date) {
		if (Number.isNaN(value.getTime())) return '';
		const year = value.getFullYear();
		if (!isPlausibleSowingYear(year)) return '';
		return toLocalDateString(year, value.getMonth(), value.getDate()) ?? '';
	}

	if (typeof value === 'number') {
		return fromYyyymmddNumber(value) ?? fromExcelSerial(value) ?? '';
	}

	const raw = String(value).trim();
	if (!raw) return '';

	const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (iso) {
		return toLocalDateString(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) ?? '';
	}

	if (/^(19|20)\d{6}$/.test(raw)) {
		return fromYyyymmddNumber(Number(raw)) ?? '';
	}

	if (/^\d{5,8}$/.test(raw) && !/^(19|20)\d{6}$/.test(raw)) {
		const fromDbf = parseDbfDateFieldRaw(raw);
		if (fromDbf) return fromDbf;
	}

	if (/^\d+(\.\d+)?$/.test(raw)) {
		const n = Number(raw);
		return fromYyyymmddNumber(n) ?? fromExcelSerial(n) ?? '';
	}

	const dmy = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/);
	if (dmy) {
		const day = Number(dmy[1]);
		const month = Number(dmy[2]);
		let year = Number(dmy[3]);
		if (dmy[3].length === 2) year = expandTwoDigitYear(year);

		if (day <= 12 && month > 12) {
			return toLocalDateString(year, day - 1, month) ?? '';
		}
		return toLocalDateString(year, month - 1, day) ?? '';
	}

	const ymd = raw.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
	if (ymd) {
		return toLocalDateString(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])) ?? '';
	}

	return '';
}

function parseLocalDate(dateStr: string): Date | null {
	const normalized = normalizeSowingDateInput(dateStr);
	if (!normalized) return null;
	const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!match) return null;
	return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function monthYearValue(calendarYear: number, calendarMonth: number): number {
	return calendarYear * 100 + calendarMonth;
}

export function getExportableMonthNeeds(schedule: WaterSchedule): MonthlyWaterNeed[] {
	if (!schedule.matchedBudget) return [];

	if (!schedule.sowingDate) {
		return schedule.monthlyNeeds;
	}

	const sowingDate = parseLocalDate(schedule.sowingDate);
	if (!sowingDate) {
		return schedule.monthlyNeeds;
	}

	const sowingValue = monthYearValue(sowingDate.getFullYear(), sowingDate.getMonth());
	return schedule.monthlyNeeds.filter(
		(need) => monthYearValue(need.calendarYear, need.calendarMonth) >= sowingValue
	);
}

export interface WaterSchedule {
	crop: string;
	season: string;
	sowingDate: string;
	acres: number;
	monthlyNeeds: MonthlyWaterNeed[];
	totalWaterMmPerAcre: number;
	totalWaterMm: number;
	totalWaterM3PerAcre: number;
	totalWaterM3: number;
	matchedBudget: boolean;
	note?: string;
}

function parseCsvLine(line: string): string[] {
	const values: string[] = [];
	let current = '';
	let inQuotes = false;

	for (const char of line) {
		if (char === '"') {
			inQuotes = !inQuotes;
			continue;
		}
		if (char === ',' && !inQuotes) {
			values.push(current.trim());
			current = '';
			continue;
		}
		current += char;
	}
	values.push(current.trim());
	return values;
}

/**
 * Parse `total_water_needed.csv` — crop + relative month 1..N depth columns (mm).
 * Values are converted to m³ per acre on load.
 */
export function parseWaterBudgetCsv(csvText: string): WaterBudgetRow[] {
	const lines = csvText.trim().split(/\r?\n/);
	if (lines.length < 2) return [];

	const headers = parseCsvLine(lines[0]).map((h) => h.trim());
	const monthCols: { index: number; monthNum: number }[] = [];

	for (let i = 0; i < headers.length; i++) {
		const m = headers[i].match(/^month\s*(\d+)$/i);
		if (m) monthCols.push({ index: i, monthNum: Number(m[1]) });
	}

	monthCols.sort((a, b) => a.monthNum - b.monthNum);
	const maxMonth = monthCols.length > 0 ? monthCols[monthCols.length - 1].monthNum : 0;

	return lines
		.slice(1)
		.filter(Boolean)
		.map((line) => {
			const cols = parseCsvLine(line);
			const monthM3PerAcre: Array<number | null> = Array.from({ length: maxMonth }, () => null);

			for (const { index, monthNum } of monthCols) {
				const raw = cols[index] ?? '';
				if (raw.trim() === '') continue;
				const mm = Number.parseFloat(raw);
				if (Number.isFinite(mm)) monthM3PerAcre[monthNum - 1] = mmPerAcreToM3PerAcre(mm);
			}

			return {
				crop: cols[0] ?? '',
				monthM3PerAcre
			};
		})
		.filter((row) => row.crop.trim() !== '');
}

/** Normalize crop names for matching (handles "Pulses (Arhar)" → pulses, etc.) */
export function normalizeCropName(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/\)+$/, '')
		.replace(/[()]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Map field crop labels onto budget crop keys in total_water_needed.csv */
function cropMatchKey(name: string): string {
	const n = normalizeCropName(name);
	if (!n) return '';

	if (n.includes('paddy') || n.includes('rice')) return 'paddy';
	if (n.includes('cotton')) return 'cotton';
	if (n.includes('groundnut') || n.includes('peanut')) return 'groundnut';
	if (n.includes('pulse') || n.includes('arhar') || n.includes('gram') || n.includes('tur'))
		return 'pulses';
	if (n.includes('millet') || n.includes('sorghum') || n.includes('bajra') || n.includes('jowar'))
		return 'millets';
	if (n.includes('sunflower')) return 'sunflower';
	if (n.includes('seasame') || n.includes('sesame') || n.includes('til')) return 'seasame';
	if (n.includes('chilli') || n.includes('chili') || n.includes('pepper')) return 'chilli';

	return n;
}

export function findBudgetRow(crop: string, budget: WaterBudgetRow[]): WaterBudgetRow | null {
	if (!crop?.trim()) return null;
	const key = cropMatchKey(crop);
	if (!key) return null;

	return (
		budget.find((row) => cropMatchKey(row.crop) === key) ??
		budget.find((row) => normalizeCropName(row.crop) === normalizeCropName(crop)) ??
		null
	);
}

/** Infer Kharif/Rabi from sowing month for export column prefixes. */
export function inferSeasonFromSowingDate(sowingDate: Date): CropSeason {
	const m = sowingDate.getMonth(); // 0–11
	// Apr (3) – Sep (8) → Kharif; Oct – Mar → Rabi
	return m >= 3 && m <= 8 ? 'Kharif' : 'Rabi';
}

function buildMonthlyNeedsFromSowing(
	monthM3PerAcre: Array<number | null>,
	sowingDate: Date,
	plotAcres: number
): MonthlyWaterNeed[] {
	const monthlyNeeds: MonthlyWaterNeed[] = [];
	let year = sowingDate.getFullYear();
	let month = sowingDate.getMonth();

	for (let i = 0; i < monthM3PerAcre.length; i++) {
		const m3PerAcre = monthM3PerAcre[i];
		if (m3PerAcre === null) {
			month += 1;
			if (month > 11) {
				month = 0;
				year += 1;
			}
			continue;
		}

		const waterM3 = m3PerAcre * plotAcres;
		const waterMmPerAcre = (m3PerAcre / ACRE_M2) * 1000;

		monthlyNeeds.push({
			month: BUDGET_MONTHS[month],
			relativeMonth: i + 1,
			calendarMonth: month,
			calendarYear: year,
			waterMmPerAcre,
			waterMm: waterMmPerAcre * plotAcres,
			waterM3PerAcre: m3PerAcre,
			waterM3
		});

		month += 1;
		if (month > 11) {
			month = 0;
			year += 1;
		}
	}

	return monthlyNeeds;
}

function sumVisibleWaterTotals(
	visibleNeeds: MonthlyWaterNeed[],
	plotAcres: number
): Pick<
	WaterSchedule,
	'totalWaterMmPerAcre' | 'totalWaterMm' | 'totalWaterM3PerAcre' | 'totalWaterM3'
> {
	const totalWaterMmPerAcre = visibleNeeds.reduce((sum, item) => sum + item.waterMmPerAcre, 0);
	const totalWaterM3PerAcre = visibleNeeds.reduce((sum, item) => sum + item.waterM3PerAcre, 0);
	const totalWaterM3 = visibleNeeds.reduce((sum, item) => sum + item.waterM3, 0);

	return {
		totalWaterMmPerAcre,
		totalWaterMm: totalWaterMmPerAcre * plotAcres,
		totalWaterM3PerAcre,
		totalWaterM3
	};
}

function emptyWaterScheduleTotals(): Pick<
	WaterSchedule,
	'totalWaterMmPerAcre' | 'totalWaterMm' | 'totalWaterM3PerAcre' | 'totalWaterM3'
> {
	return {
		totalWaterMmPerAcre: 0,
		totalWaterMm: 0,
		totalWaterM3PerAcre: 0,
		totalWaterM3: 0
	};
}

/**
 * Build a water schedule starting at the sowing date.
 * Month 1 of the budget aligns with the sowing calendar month.
 */
export function calculateWaterSchedule(
	crop: string,
	sowingDateStr: string,
	budget: WaterBudgetRow[],
	acres = 1
): WaterSchedule {
	const plotAcres = Number.isFinite(acres) && acres > 0 ? acres : 1;
	const normalizedDate = normalizeSowingDateInput(sowingDateStr);
	const sowingDate = parseLocalDate(normalizedDate);
	if (!sowingDate) {
		return {
			crop,
			season: '',
			sowingDate: sowingDateStr,
			acres: plotAcres,
			monthlyNeeds: [],
			...emptyWaterScheduleTotals(),
			matchedBudget: false,
			note: 'Invalid sowing date'
		};
	}

	const budgetRow = findBudgetRow(crop, budget);
	if (!budgetRow) {
		return {
			crop,
			season: '',
			sowingDate: normalizedDate,
			acres: plotAcres,
			monthlyNeeds: [],
			...emptyWaterScheduleTotals(),
			matchedBudget: false,
			note: `No water budget found for crop "${crop}"`
		};
	}

	const season = inferSeasonFromSowingDate(sowingDate);
	const monthlyNeeds = buildMonthlyNeedsFromSowing(budgetRow.monthM3PerAcre, sowingDate, plotAcres);
	const visibleNeeds = getExportableMonthNeeds({
		crop,
		season,
		sowingDate: normalizedDate,
		acres: plotAcres,
		monthlyNeeds,
		...emptyWaterScheduleTotals(),
		matchedBudget: true
	});
	const totals = sumVisibleWaterTotals(visibleNeeds, plotAcres);

	return {
		crop,
		season,
		sowingDate: normalizedDate,
		acres: plotAcres,
		monthlyNeeds,
		...totals,
		matchedBudget: true
	};
}

/**
 * When no per-plot sowing date exists, use a default start date
 * (or a season → default sowing date mapping).
 */
export function calculateWaterScheduleBySeason(
	crop: string,
	season: CropSeason,
	budget: WaterBudgetRow[],
	acres = 1,
	referenceYear = new Date().getFullYear()
): WaterSchedule {
	// Default sowing anchors when only season is known
	const sowingDateStr =
		season === 'Rabi'
			? `${referenceYear}-11-15`
			: `${referenceYear}-06-15`;

	const schedule = calculateWaterSchedule(crop, sowingDateStr, budget, acres);
	if (!schedule.matchedBudget) {
		return {
			...schedule,
			season,
			note: schedule.note ?? `No water budget found for crop "${crop}"`
		};
	}
	return { ...schedule, season };
}

/** List of crops available in the budget CSV (for the calculator palette). */
export function listBudgetCrops(budget: WaterBudgetRow[]): string[] {
	return budget.map((r) => r.crop);
}

export function cropTotalM3PerAcre(row: WaterBudgetRow): number {
	return row.monthM3PerAcre.reduce<number>((s, v) => s + (v ?? 0), 0);
}

/** @deprecated use cropTotalM3PerAcre — kept for callers during rename */
export function cropTotalMm(row: WaterBudgetRow): number {
	return (cropTotalM3PerAcre(row) / ACRE_M2) * 1000;
}

export function formatCalendarMonth(monthIndex: number, year: number): string {
	return new Date(year, monthIndex, 1).toLocaleDateString('en-IN', {
		month: 'short',
		year: 'numeric'
	});
}
