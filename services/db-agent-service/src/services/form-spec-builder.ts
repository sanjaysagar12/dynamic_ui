import type { FormFieldSpec, FormSpec } from '../schemas.js';
import type { ColumnRow, ConstraintRow, EnumRow } from './schema-service.js';

const NUMERIC_TYPES = new Set([
  'integer',
  'bigint',
  'smallint',
  'numeric',
  'real',
  'double precision',
  'decimal',
]);

const DATE_TYPES = new Set(['date', 'timestamp without time zone', 'timestamp with time zone']);

/** "category_id" -> "Category", "created_at" -> "Created At". Strips a trailing "_id" (the
 *  common FK-naming convention) since "Category Id" reads worse than "Category" for a dropdown
 *  whose options are already category names. */
export function humanizeLabel(column: string): string {
  const stripped = column.replace(/_id$/, '');
  return stripped
    .split('_')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

function isRequired(column: ColumnRow): boolean {
  return !column.is_nullable && column.column_default === null;
}

function findPrimaryKeyColumns(table: string, constraints: ConstraintRow[]): Set<string> {
  const pk = constraints.find((c) => c.table_name === table && c.constraint_type === 'p');
  const match = pk?.definition.match(/PRIMARY KEY \(([^)]+)\)/i);
  if (!match) return new Set();
  return new Set(match[1].split(',').map((s) => s.trim()));
}

interface ForeignKeyRef {
  table: string;
  column: string;
}

/** Maps a table's own column name -> the table/column it references, parsed from
 *  pg_get_constraintdef's "FOREIGN KEY (col) REFERENCES other_table(other_col)" text.
 *  Only single-column FKs are recognized — a composite FK falls back to a plain text field. */
function findForeignKeys(table: string, constraints: ConstraintRow[]): Map<string, ForeignKeyRef> {
  const result = new Map<string, ForeignKeyRef>();
  for (const c of constraints) {
    if (c.table_name !== table || c.constraint_type !== 'f') continue;
    const match = c.definition.match(/FOREIGN KEY \(([^)]+)\) REFERENCES (\w+)\(([^)]+)\)/i);
    if (!match) continue;
    const [, cols, refTable, refCols] = match;
    if (cols.includes(',') || refCols.includes(',')) continue;
    result.set(cols.trim(), { table: refTable, column: refCols.trim() });
  }
  return result;
}

/** Best-effort guess at which column on a referenced table is worth showing a human instead of
 *  its id — prefers a "name"/"title" column if one exists, else falls back to that table's own
 *  primary key (still real data, just less friendly). */
function guessLabelColumn(refTable: string, allColumns: ColumnRow[], allConstraints: ConstraintRow[]): string {
  const refColumns = allColumns.filter((c) => c.table_name === refTable);
  const preferred = refColumns.find((c) => c.column_name === 'name' || c.column_name === 'title');
  if (preferred) return preferred.column_name;
  const pk = findPrimaryKeyColumns(refTable, allConstraints);
  return pk.values().next().value ?? 'id';
}

function deriveFieldType(
  column: ColumnRow,
  foreignKey: ForeignKeyRef | undefined,
  enumValuesByType: Map<string, string[]>,
): { type: FormFieldSpec['type']; options?: { value: unknown; label: string }[] } {
  if (foreignKey) {
    return { type: 'foreign_key' };
  }
  const enumValues = enumValuesByType.get(column.udt_name);
  if (enumValues?.length) {
    return { type: 'select', options: enumValues.map((v) => ({ value: v, label: v })) };
  }
  if (column.data_type === 'boolean') {
    return { type: 'boolean' };
  }
  if (DATE_TYPES.has(column.data_type)) {
    return { type: 'date' };
  }
  if (NUMERIC_TYPES.has(column.data_type)) {
    return { type: 'number' };
  }
  return { type: 'text' };
}

/**
 * Builds a FormSpec for a single table/operation from live schema data — see SchemaService.getTableInfo.
 * `requestedFields` are the columns the model judged relevant to this write; for an insert, any
 * NOT NULL/no-default column that isn't already requested (and isn't the primary key) is force-
 * included, so a model that forgets a required column still can't produce a form missing it.
 * `knownValues` is the *only* source of a field's `default` — never a DB column_default, and
 * never a guess by this function.
 */
export function buildFormSpec(
  table: string,
  operation: 'insert' | 'update',
  requestedFields: string[],
  knownValues: Record<string, unknown>,
  match: { id: string } | undefined,
  columns: ColumnRow[],
  constraints: ConstraintRow[],
  enums: EnumRow[],
): FormSpec {
  const columnsByName = new Map(columns.filter((c) => c.table_name === table).map((c) => [c.column_name, c]));
  const primaryKeyColumns = findPrimaryKeyColumns(table, constraints);
  const foreignKeys = findForeignKeys(table, constraints);

  const enumValuesByType = new Map<string, string[]>();
  for (const row of enums) {
    const list = enumValuesByType.get(row.enum_name) ?? [];
    list.push(row.enum_value);
    enumValuesByType.set(row.enum_name, list);
  }

  const fieldNames = new Set(requestedFields.filter((name) => columnsByName.has(name)));

  if (operation === 'insert') {
    for (const column of columnsByName.values()) {
      if (isRequired(column) && !primaryKeyColumns.has(column.column_name)) {
        fieldNames.add(column.column_name);
      }
    }
  }

  const fields: FormFieldSpec[] = [...fieldNames].flatMap((name) => {
    const column = columnsByName.get(name);
    if (!column) return [];
    const foreignKey = foreignKeys.get(name);
    const { type, options } = deriveFieldType(column, foreignKey, enumValuesByType);
    const field: FormFieldSpec = {
      name,
      label: humanizeLabel(name),
      type,
      required: isRequired(column),
    };
    if (Object.prototype.hasOwnProperty.call(knownValues, name)) {
      field.default = knownValues[name];
    }
    if (options) {
      field.options = options;
    }
    if (foreignKey) {
      field.referenceTable = foreignKey.table;
      field.referenceLabelColumn = guessLabelColumn(foreignKey.table, columns, constraints);
    }
    return [field];
  });

  return { table, operation, match, fields };
}

/** Server-side gate for POST /agent/submit-form — recomputes required-ness from the live schema
 *  rather than trusting anything the client sent, and returns the column names that are missing
 *  or empty so the caller can report exactly what's still needed. */
export function findMissingRequiredFields(
  table: string,
  values: Record<string, unknown>,
  columns: ColumnRow[],
  constraints: ConstraintRow[],
): string[] {
  const primaryKeyColumns = findPrimaryKeyColumns(table, constraints);
  const missing: string[] = [];
  for (const column of columns) {
    if (column.table_name !== table) continue;
    if (primaryKeyColumns.has(column.column_name)) continue;
    if (!isRequired(column)) continue;
    const value = values[column.column_name];
    if (value === undefined || value === null || value === '') {
      missing.push(column.column_name);
    }
  }
  return missing;
}

/** Rejects any key in `values` that isn't a real column of `table` — defense in depth before
 *  values ever reach supabase-service, since request_form only ever offers real column names but
 *  the submit-form client payload isn't otherwise trusted. */
export function findUnknownFields(table: string, values: Record<string, unknown>, columns: ColumnRow[]): string[] {
  const knownColumns = new Set(columns.filter((c) => c.table_name === table).map((c) => c.column_name));
  return Object.keys(values).filter((name) => !knownColumns.has(name));
}
