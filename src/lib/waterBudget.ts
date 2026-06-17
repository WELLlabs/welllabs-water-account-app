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
	const sowingDate = new Date(sowingDateStr);
	if (Number.isNaN(sowingDate.getTime())) {
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

	const startBudgetIndex = CALENDAR_TO_BUDGET_INDEX[sowingDate.getMonth()];
	const endParsed = parseMonthDay(budgetRow.endMonth);
	const endBudgetIndex = CALENDAR_TO_BUDGET_INDEX[endParsed.month];

	const monthlyNeeds: MonthlyWaterNeed[] = [];
	let currentIndex = startBudgetIndex;
	let year = sowingDate.getFullYear();
	let previousCalendarMonth = sowingDate.getMonth();

	for (let step = 0; step < 12; step++) {
		const budgetMonth = BUDGET_MONTHS[currentIndex];
		const calendarMonth = budgetIndexToCalendarMonth(currentIndex);

		if (calendarMonth < previousCalendarMonth) {
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
	}

	const totalWaterMmPerAcre = monthlyNeeds.reduce((sum, item) => sum + item.waterMmPerAcre, 0);
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
