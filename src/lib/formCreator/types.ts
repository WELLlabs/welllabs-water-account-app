export type FormFieldType =
	| 'text'
	| 'integer'
	| 'real'
	| 'date'
	| 'datetime'
	| 'boolean'
	| 'valuemap'
	| 'multiselect'
	| 'valuerelation'
	| 'attachment';

export interface FormFieldOption {
	value: string;
	label: string;
}

export interface FormField {
	id: string;
	name: string;
	label: string;
	type: FormFieldType;
	required?: boolean;
	options?: FormFieldOption[];
	/** For ValueRelation: filter expression referencing parent field */
	relationFilter?: string;
	isDefault?: boolean;
}

/** A single column from the imported boundary file */
export interface ColumnConfig {
	name: string;
	/** First non-null value, displayed as a preview */
	sample: string;
	keep: boolean;
	/** ID and area columns are locked — cannot be removed */
	locked: boolean;
	role: 'id' | 'area' | 'none';
}

export interface FicMapping {
	lateral: string;
	fics: string[];
}

export interface FormProjectConfig {
	projectName: string;
	tableName: string;
	fields: FormField[];
	ficMappings: FicMapping[];
	/** All basemaps selected for inclusion in the QGZ (ordered, first = top of layer tree) */
	basemaps: import('./basemaps').AnyBasemap[];
	boundaries: GeoJSON.FeatureCollection;
	/** Columns from the imported file that should be preserved in the exported GPKG */
	keptColumns: ColumnConfig[];
}

export const QGIS_FIELD_TYPES: Record<FormFieldType, string> = {
	text: 'TEXT',
	integer: 'INTEGER',
	real: 'REAL',
	date: 'TEXT',
	datetime: 'TEXT',
	boolean: 'INTEGER',
	valuemap: 'TEXT',
	multiselect: 'TEXT',
	valuerelation: 'TEXT',
	attachment: 'TEXT'
};
