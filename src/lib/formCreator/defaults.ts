import type { FicMapping, FormField } from './types';

export const DEFAULT_LATERALS = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'];

/** Default FIC counts per lateral (editable in form builder). */
export const DEFAULT_FIC_MAPPINGS: FicMapping[] = [
	{ lateral: 'L1', fics: ['FIC 1', 'FIC 2', 'FIC 3', 'FIC 4', 'FIC 5', 'FIC 6', 'FIC 7', 'FIC 8'] },
	{ lateral: 'L2', fics: ['FIC 1', 'FIC 2', 'FIC 3', 'FIC 4', 'FIC 5', 'FIC 6', 'FIC 7'] },
	{ lateral: 'L3', fics: ['FIC 1', 'FIC 2', 'FIC 3', 'FIC 4', 'FIC 5', 'FIC 6'] },
	{ lateral: 'L4', fics: ['FIC 1', 'FIC 2', 'FIC 3', 'FIC 4', 'FIC 5'] },
	{ lateral: 'L5', fics: ['FIC 1', 'FIC 2', 'FIC 3', 'FIC 4'] },
	{ lateral: 'L6', fics: ['FIC 1', 'FIC 2', 'FIC 3'] }
];

export const IRRIGATION_STATUS_OPTIONS = [
	{ value: 'canal', label: 'Canal' },
	{ value: 'lift', label: 'Lift' },
	{ value: 'not_irrigated', label: 'Not irrigated' }
];

export const CONJUNCTIVE_OPTIONS = [
	{ value: 'rain', label: 'Rain' },
	{ value: 'canal', label: 'Canal' },
	{ value: 'groundwater', label: 'Groundwater' }
];

export function createDefaultFields(): FormField[] {
	return [
		{
			id: crypto.randomUUID(),
			name: 'farmer_name',
			label: 'Farmer Name',
			type: 'text',
			required: true,
			isDefault: true
		},
		{
			id: crypto.randomUUID(),
			name: 'farmer_ph_no',
			label: 'Farmer Phone Number',
			type: 'text',
			required: true,
			isDefault: true
		},
		{
			id: crypto.randomUUID(),
			name: 'crop',
			label: 'Crop',
			type: 'text',
			required: true,
			isDefault: true
		},
		{
			id: crypto.randomUUID(),
			name: 'sowing_date',
			label: 'Sowing Date',
			type: 'date',
			required: true,
			isDefault: true
		},
		{
			id: crypto.randomUUID(),
			name: 'irrigation_status',
			label: 'Irrigation Status',
			type: 'valuemap',
			options: IRRIGATION_STATUS_OPTIONS.map((o) => ({ ...o })),
			required: true,
			isDefault: true
		},
		{
			id: crypto.randomUUID(),
			name: 'lateral',
			label: 'Lateral',
			type: 'valuemap',
			options: DEFAULT_LATERALS.map((l) => ({ value: l, label: l })),
			required: true,
			isDefault: true
		},
		{
			id: crypto.randomUUID(),
			name: 'fic',
			label: 'FIC',
			type: 'valuerelation',
			relationFilter: `"lateral" = current_value('lateral')`,
			required: true,
			isDefault: true
		},
		{
			id: crypto.randomUUID(),
			name: 'conjunctives',
			label: 'Conjunctives',
			type: 'valuemap',
			options: CONJUNCTIVE_OPTIONS.map((o) => ({ ...o })),
			isDefault: true
		}
	];
}

export function createFieldId(): string {
	return crypto.randomUUID();
}

export const CUSTOM_FIELD_TYPES: { value: FormField['type']; label: string }[] = [
	{ value: 'text', label: 'Text' },
	{ value: 'integer', label: 'Integer' },
	{ value: 'real', label: 'Decimal number' },
	{ value: 'date', label: 'Date' },
	{ value: 'datetime', label: 'Date & time' },
	{ value: 'boolean', label: 'Yes / No' },
	{ value: 'valuemap', label: 'Single select (dropdown)' },
	{ value: 'multiselect', label: 'Multi-select (checkboxes)' },
	{ value: 'attachment', label: 'Photo / file' }
];
