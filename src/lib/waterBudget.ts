export interface WaterBudgetRow {
	crop: string;
	season: string;
	startMonth: string;
	endMonth: string;
	monthlyWater: Record<BudgetMonth, number>;
}

export type BudgetMonth =
	| 'June'
	| 'July'
	| 'August'
	| 'September'
	| 'October'
	| 'November'
	| 'December'
	| 'January'
	| 'February'
	| 'March'
	| 'April'
	| 'May';

export const BUDGET_MONTHS: BudgetMonth[] = [
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December',
	'January',
	'February',
	'March',
	'April',
	'May'
];

export interface MonthlyWaterNeed {
	month: BudgetMonth;
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

	// Exclude columns from years before the most recent sowing year.
	// This prevents stale columns (e.g. one outlier 2025 plot) from creating
	// null-filled columns across all other features.
	const filtered =
		maxSowingYear > 0
			? [...names].filter((col) => {
					const year = Number(col.split('_').pop());
					return year >= maxSowingYear;
				})
			: [...names];

	// Sort chronologically (year first, then calendar month index within the year)
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
	// Typical agricultural dates fall ~1990–2040 → serials ~32874–61364
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
 * When `referenceYear` is set (e.g. from SURVEY_DAT) and the parsed year is
 * more than 3 years away, keep day/month and use the reference year.
 */
export function parseDbfDateFieldRaw(raw: string, referenceYear?: number): string {
	const trimmed = raw.replace(/\0/g, '').trim();
	if (!trimmed || /^0+$/.test(trimmed)) return '';

	// Proper DBF date: YYYYMMDD
	if (/^(19|20)\d{6}$/.test(trimmed)) {
		return fromYyyymmddNumber(Number(trimmed)) ?? '';
	}

	if (!/^\d{1,8}$/.test(trimmed)) return '';

	let day: number;
	let month: number;
	let yy: number;

	if (trimmed.length >= 6) {
		// dd/mm/yy
		const padded = trimmed.padStart(6, '0').slice(-6);
		day = Number(padded.slice(0, 2));
		month = Number(padded.slice(2, 4));
		yy = Number(padded.slice(4, 6));
	} else if (trimmed.length === 5) {
		// d/mm/yy (e.g. 20710 → 2/07/10), as written without leading zero on day
		day = Number(trimmed.slice(0, 1));
		month = Number(trimmed.slice(1, 3));
		yy = Number(trimmed.slice(3, 5));
		// If that month is invalid, try dd/m/yy (e.g. 10710 could be 10/7/10)
		if (month < 1 || month > 12) {
			day = Number(trimmed.slice(0, 2));
			month = Number(trimmed.slice(2, 3));
			yy = Number(trimmed.slice(3, 5));
		}
	} else if (trimmed.length === 4) {
		// d/m/yy
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
 * Handles Date objects, ISO strings, DBF YYYYMMDD, DD/MM/YY, DD/MM/YYYY, and Excel serials.
 * Returns '' when the value cannot be interpreted as a plausible sowing date.
 */
export function normalizeSowingDateInput(value: unknown): string {
	if (value === null || value === undefined || value === '') return '';

	if (value instanceof Date) {
		if (Number.isNaN(value.getTime())) return '';
		const year = value.getFullYear();
		// Reject Excel-epoch leftovers and other nonsense years
		if (!isPlausibleSowingYear(year)) return '';
		return toLocalDateString(year, value.getMonth(), value.getDate()) ?? '';
	}

	if (typeof value === 'number') {
		return fromYyyymmddNumber(value) ?? fromExcelSerial(value) ?? '';
	}

	const raw = String(value).trim();
	if (!raw) return '';

	// Already ISO date or datetime
	const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (iso) {
		return toLocalDateString(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) ?? '';
	}

	// Compact YYYYMMDD
	if (/^(19|20)\d{6}$/.test(raw)) {
		return fromYyyymmddNumber(Number(raw)) ?? '';
	}

	// DBF-style padded dd/mm/yy digits (e.g. "   20710" or "020710")
	if (/^\d{5,8}$/.test(raw) && !/^(19|20)\d{6}$/.test(raw)) {
		const fromDbf = parseDbfDateFieldRaw(raw);
		if (fromDbf) return fromDbf;
	}

	// Excel serial as string
	if (/^\d+(\.\d+)?$/.test(raw)) {
		const n = Number(raw);
		return fromYyyymmddNumber(n) ?? fromExcelSerial(n) ?? '';
	}

	// DD/MM/YY or DD/MM/YYYY (and -, .) — India-style; day first
	const dmy = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/);
	if (dmy) {
		const day = Number(dmy[1]);
		const month = Number(dmy[2]);
		let year = Number(dmy[3]);
		if (dmy[3].length === 2) year = expandTwoDigitYear(year);

		// If first part looks like a month and second like a day (US-style), only swap when unambiguous
		if (day <= 12 && month > 12) {
			return toLocalDateString(year, day - 1, month) ?? '';
		}
		return toLocalDateString(year, month - 1, day) ?? '';
	}

	const ymd = raw.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
	if (ymd) {
		return toLocalDateString(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])) ?? '';
	}

	// Last resort: Date.parse is unreliable for dd/mm/yy — avoid inventing years
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

const MONTH_NAME_TO_INDEX: Record<string, number> = {
	january: 0,
	jan: 0,
	february: 1,
	feb: 1,
	march: 2,
	mar: 2,
	april: 3,
	apr: 3,
	may: 4,
	june: 5,
	jun: 5,
	july: 6,
	jul: 6,
	august: 7,
	aug: 7,
	september: 8,
	sep: 8,
	sept: 8,
	october: 9,
	oct: 9,
	november: 10,
	nov: 10,
	december: 11,
	dec: 11
};

const CALENDAR_TO_BUDGET_INDEX: Record<number, number> = {
	0: 7,
	1: 8,
	2: 9,
	3: 10,
	4: 11,
	5: 0,
	6: 1,
	7: 2,
	8: 3,
	9: 4,
	10: 5,
	11: 6
};

function parseMonthDay(value: string): { month: number; day: number } {
	const cleaned = value.trim().replace(/(\d+)(st|nd|rd|th)/i, '$1');
	const match = cleaned.match(/^([A-Za-z]+)\s*(\d+)?/);
	if (!match) return { month: 0, day: 1 };

	const monthKey = match[1].toLowerCase();
	const month = MONTH_NAME_TO_INDEX[monthKey] ?? 0;
	const day = match[2] ? Number.parseInt(match[2], 10) : 1;
	return { month, day };
}

function budgetIndexToCalendarMonth(index: number): number {
	return BUDGET_MONTHS[index] === 'January'
		? 0
		: BUDGET_MONTHS[index] === 'February'
			? 1
			: BUDGET_MONTHS[index] === 'March'
				? 2
				: BUDGET_MONTHS[index] === 'April'
					? 3
					: BUDGET_MONTHS[index] === 'May'
						? 4
						: BUDGET_MONTHS[index] === 'June'
							? 5
							: BUDGET_MONTHS[index] === 'July'
								? 6
								: BUDGET_MONTHS[index] === 'August'
									? 7
									: BUDGET_MONTHS[index] === 'September'
										? 8
										: BUDGET_MONTHS[index] === 'October'
											? 9
											: BUDGET_MONTHS[index] === 'November'
												? 10
												: 11;
}

function normalizeCropName(name: string): string {
	return name.trim().toLowerCase().replace(/\)+$/, '');
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

export function parseWaterBudgetCsv(csvText: string): WaterBudgetRow[] {
	const lines = csvText.trim().split(/\r?\n/);
	if (lines.length < 2) return [];

	const headers = parseCsvLine(lines[0]);
	const monthStartIndex = headers.indexOf('June');

	return lines.slice(1).filter(Boolean).map((line) => {
		const cols = parseCsvLine(line);
		const monthlyWater = {} as Record<BudgetMonth, number>;

		for (let i = 0; i < BUDGET_MONTHS.length; i++) {
			const value = Number.parseFloat(cols[monthStartIndex + i] ?? '0');
			monthlyWater[BUDGET_MONTHS[i]] = Number.isFinite(value) ? value : 0;
		}

		return {
			crop: cols[0] ?? '',
			season: cols[1] ?? '',
			startMonth: cols[2] ?? '',
			endMonth: cols[3] ?? '',
			monthlyWater
		};
	});
}

function findBudgetRow(crop: string, sowingDate: Date, budget: WaterBudgetRow[]): WaterBudgetRow | null {
	if (!crop?.trim()) return null;

	const normalized = normalizeCropName(crop);
	const matches = budget.filter((row) => normalizeCropName(row.crop) === normalized);
	if (matches.length === 0) return null;
	if (matches.length === 1) return matches[0];

	const sowingMonth = sowingDate.getMonth();
	const sowingDay = sowingDate.getDate();

	let best: WaterBudgetRow | null = null;
	let bestScore = Number.NEGATIVE_INFINITY;

	for (const row of matches) {
		const start = parseMonthDay(row.startMonth);
		const end = parseMonthDay(row.endMonth);
		let score = 0;

		if (isDateInSeason(sowingMonth, sowingDay, start.month, start.day, end.month, end.day)) {
			score += 100;
		}

		score -= Math.abs(sowingMonth - start.month);
		if (score > bestScore) {
			bestScore = score;
			best = row;
		}
	}

	return best;
}

function findBudgetRowBySeason(
	crop: string,
	season: CropSeason,
	budget: WaterBudgetRow[]
): WaterBudgetRow | null {
	if (!crop?.trim()) return null;

	const normalized = normalizeCropName(crop);
	const seasonLower = season.toLowerCase();

	return (
		budget.find(
			(row) =>
				normalizeCropName(row.crop) === normalized && row.season.toLowerCase() === seasonLower
		) ?? null
	);
}

function seasonReferenceYear(sowingDate: Date, seasonStartMonth: number): number {
	const sowingYear = sowingDate.getFullYear();
	const sowingMonth = sowingDate.getMonth();

	// Rabi seasons start in late year; sowing in Jan–Mar belongs to season that started previous calendar year.
	if (sowingMonth < seasonStartMonth && seasonStartMonth >= 10 && sowingMonth < 4) {
		return sowingYear - 1;
	}

	return sowingYear;
}

function resolveEndBudgetIndex(budgetRow: WaterBudgetRow): number {
	const endParsed = parseMonthDay(budgetRow.endMonth);
	return CALENDAR_TO_BUDGET_INDEX[endParsed.month];
}

function buildMonthlyNeedsFromBudgetRow(
	budgetRow: WaterBudgetRow,
	startBudgetIndex: number,
	endBudgetIndex: number,
	plotAcres: number,
	referenceYear: number
): MonthlyWaterNeed[] {
	const monthlyNeeds: MonthlyWaterNeed[] = [];
	let currentIndex = startBudgetIndex;
	let year = referenceYear;
	let previousCalendarMonth = budgetIndexToCalendarMonth(startBudgetIndex);
	let steps = 0;

	while (steps < 12) {
		const budgetMonth = BUDGET_MONTHS[currentIndex];
		const calendarMonth = budgetIndexToCalendarMonth(currentIndex);

		if (steps > 0 && calendarMonth < previousCalendarMonth) {
			year += 1;
		}
		previousCalendarMonth = calendarMonth;

		const mmPerAcre = budgetRow.monthlyWater[budgetMonth];
		monthlyNeeds.push({
			month: budgetMonth,
			calendarMonth,
			calendarYear: year,
			waterMmPerAcre: mmPerAcre,
			waterMm: mmPerAcre * plotAcres,
			waterM3PerAcre: mmPerAcreToM3PerAcre(mmPerAcre),
			waterM3: mmDepthToM3(mmPerAcre, plotAcres)
		});

		if (currentIndex === endBudgetIndex) break;

		currentIndex = (currentIndex + 1) % 12;
		steps += 1;
	}

	return monthlyNeeds;
}

function isDateInSeason(
	month: number,
	day: number,
	startMonth: number,
	startDay: number,
	endMonth: number,
	endDay: number
): boolean {
	const dateValue = month * 100 + day;
	const startValue = startMonth * 100 + startDay;
	const endValue = endMonth * 100 + endDay;

	if (startValue <= endValue) {
		return dateValue >= startValue && dateValue <= endValue;
	}

	return dateValue >= startValue || dateValue <= endValue;
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

	const budgetRow = findBudgetRow(crop, sowingDate, budget);
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

	const seasonStartParsed = parseMonthDay(budgetRow.startMonth);
	const seasonStartBudgetIndex = CALENDAR_TO_BUDGET_INDEX[seasonStartParsed.month];
	const endBudgetIndex = resolveEndBudgetIndex(budgetRow);
	const referenceYear = seasonReferenceYear(sowingDate, seasonStartParsed.month);

	const monthlyNeeds = buildMonthlyNeedsFromBudgetRow(
		budgetRow,
		seasonStartBudgetIndex,
		endBudgetIndex,
		plotAcres,
		referenceYear
	);

	const visibleNeeds = getExportableMonthNeeds({
		crop,
		season: budgetRow.season,
		sowingDate: normalizedDate,
		acres: plotAcres,
		monthlyNeeds,
		...emptyWaterScheduleTotals(),
		matchedBudget: true
	});
	const totals = sumVisibleWaterTotals(visibleNeeds, plotAcres);

	return {
		crop,
		season: budgetRow.season,
		sowingDate: normalizedDate,
		acres: plotAcres,
		monthlyNeeds,
		...totals,
		matchedBudget: true
	};
}

export function calculateWaterScheduleBySeason(
	crop: string,
	season: CropSeason,
	budget: WaterBudgetRow[],
	acres = 1,
	referenceYear = new Date().getFullYear()
): WaterSchedule {
	const plotAcres = Number.isFinite(acres) && acres > 0 ? acres : 1;
	const budgetRow = findBudgetRowBySeason(crop, season, budget);

	if (!budgetRow) {
		return {
			crop,
			season,
			sowingDate: '',
			acres: plotAcres,
			monthlyNeeds: [],
			...emptyWaterScheduleTotals(),
			matchedBudget: false,
			note: `No ${season} water budget found for crop "${crop}"`
		};
	}

	const startParsed = parseMonthDay(budgetRow.startMonth);
	const endParsed = parseMonthDay(budgetRow.endMonth);
	const startBudgetIndex = CALENDAR_TO_BUDGET_INDEX[startParsed.month];
	const endBudgetIndex = resolveEndBudgetIndex(budgetRow);
	const sowingDateStr = `${referenceYear}-${String(startParsed.month + 1).padStart(2, '0')}-${String(startParsed.day).padStart(2, '0')}`;

	const monthlyNeeds = buildMonthlyNeedsFromBudgetRow(
		budgetRow,
		startBudgetIndex,
		endBudgetIndex,
		plotAcres,
		referenceYear
	);

	const visibleNeeds = getExportableMonthNeeds({
		crop,
		season: budgetRow.season,
		sowingDate: sowingDateStr,
		acres: plotAcres,
		monthlyNeeds,
		...emptyWaterScheduleTotals(),
		matchedBudget: true
	});
	const totals = sumVisibleWaterTotals(visibleNeeds, plotAcres);

	return {
		crop,
		season: budgetRow.season,
		sowingDate: sowingDateStr,
		acres: plotAcres,
		monthlyNeeds,
		...totals,
		matchedBudget: true
	};
}

export function formatCalendarMonth(monthIndex: number, year: number): string {
	return new Date(year, monthIndex, 1).toLocaleDateString('en-IN', {
		month: 'short',
		year: 'numeric'
	});
}
