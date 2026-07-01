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
}

export type CropSeason = 'Kharif' | 'Rabi';

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
			need.waterMm
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

function parseLocalDate(dateStr: string): Date | null {
	const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
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

		monthlyNeeds.push({
			month: budgetMonth,
			calendarMonth,
			calendarYear: year,
			waterMmPerAcre: budgetRow.monthlyWater[budgetMonth],
			waterMm: budgetRow.monthlyWater[budgetMonth] * plotAcres
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

export function calculateWaterSchedule(
	crop: string,
	sowingDateStr: string,
	budget: WaterBudgetRow[],
	acres = 1
): WaterSchedule {
	const plotAcres = Number.isFinite(acres) && acres > 0 ? acres : 1;
	const sowingDate = parseLocalDate(sowingDateStr);
	if (!sowingDate) {
		return {
			crop,
			season: '',
			sowingDate: sowingDateStr,
			acres: plotAcres,
			monthlyNeeds: [],
			totalWaterMmPerAcre: 0,
			totalWaterMm: 0,
			matchedBudget: false,
			note: 'Invalid sowing date'
		};
	}

	const budgetRow = findBudgetRow(crop, sowingDate, budget);
	if (!budgetRow) {
		return {
			crop,
			season: '',
			sowingDate: sowingDateStr,
			acres: plotAcres,
			monthlyNeeds: [],
			totalWaterMmPerAcre: 0,
			totalWaterMm: 0,
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
		sowingDate: sowingDateStr,
		acres: plotAcres,
		monthlyNeeds,
		totalWaterMmPerAcre: 0,
		totalWaterMm: 0,
		matchedBudget: true
	});
	const totalWaterMmPerAcre = visibleNeeds.reduce((sum, item) => sum + item.waterMmPerAcre, 0);
	const totalWaterMm = totalWaterMmPerAcre * plotAcres;

	return {
		crop,
		season: budgetRow.season,
		sowingDate: sowingDateStr,
		acres: plotAcres,
		monthlyNeeds,
		totalWaterMmPerAcre,
		totalWaterMm,
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
			totalWaterMmPerAcre: 0,
			totalWaterMm: 0,
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
		totalWaterMmPerAcre: 0,
		totalWaterMm: 0,
		matchedBudget: true
	});
	const totalWaterMmPerAcre = visibleNeeds.reduce((sum, item) => sum + item.waterMmPerAcre, 0);
	const totalWaterMm = totalWaterMmPerAcre * plotAcres;

	return {
		crop,
		season: budgetRow.season,
		sowingDate: sowingDateStr,
		acres: plotAcres,
		monthlyNeeds,
		totalWaterMmPerAcre,
		totalWaterMm,
		matchedBudget: true
	};
}

export function formatCalendarMonth(monthIndex: number, year: number): string {
	return new Date(year, monthIndex, 1).toLocaleDateString('en-IN', {
		month: 'short',
		year: 'numeric'
	});
}
