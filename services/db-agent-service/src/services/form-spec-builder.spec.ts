import { buildFormSpec, findMissingRequiredFields, findUnknownFields, humanizeLabel } from './form-spec-builder.js';
import type { ColumnRow, ConstraintRow, EnumRow } from './schema-service.js';

function column(overrides: Partial<ColumnRow> & Pick<ColumnRow, 'table_name' | 'column_name'>): ColumnRow {
  return {
    data_type: 'text',
    udt_name: 'text',
    is_nullable: false,
    column_default: null,
    ordinal_position: 0,
    ...overrides,
  };
}

const productColumns: ColumnRow[] = [
  column({ table_name: 'products', column_name: 'id', column_default: 'gen_random_uuid()', ordinal_position: 1 }),
  column({ table_name: 'products', column_name: 'name', ordinal_position: 2 }),
  column({ table_name: 'products', column_name: 'price', data_type: 'numeric', udt_name: 'numeric', ordinal_position: 3 }),
  column({ table_name: 'products', column_name: 'category_id', ordinal_position: 4 }),
  column({
    table_name: 'products',
    column_name: 'status',
    data_type: 'USER-DEFINED',
    udt_name: 'product_status',
    ordinal_position: 5,
  }),
  column({
    table_name: 'products',
    column_name: 'notes',
    is_nullable: true,
    ordinal_position: 6,
  }),
  column({
    table_name: 'products',
    column_name: 'created_at',
    data_type: 'timestamp with time zone',
    udt_name: 'timestamptz',
    column_default: 'now()',
    ordinal_position: 7,
  }),
  column({ table_name: 'categories', column_name: 'id', column_default: 'gen_random_uuid()', ordinal_position: 1 }),
  column({ table_name: 'categories', column_name: 'name', ordinal_position: 2 }),
];

const productConstraints: ConstraintRow[] = [
  { table_name: 'products', constraint_name: 'products_pkey', constraint_type: 'p', definition: 'PRIMARY KEY (id)' },
  {
    table_name: 'products',
    constraint_name: 'products_category_id_fkey',
    constraint_type: 'f',
    definition: 'FOREIGN KEY (category_id) REFERENCES categories(id)',
  },
  { table_name: 'categories', constraint_name: 'categories_pkey', constraint_type: 'p', definition: 'PRIMARY KEY (id)' },
];

const enums: EnumRow[] = [
  { enum_name: 'product_status', enum_value: 'active' },
  { enum_name: 'product_status', enum_value: 'discontinued' },
];

describe('humanizeLabel', () => {
  it('title-cases snake_case columns', () => {
    expect(humanizeLabel('created_at')).toBe('Created At');
  });

  it('strips a trailing _id suffix', () => {
    expect(humanizeLabel('category_id')).toBe('Category');
  });
});

describe('buildFormSpec', () => {
  it('force-includes NOT NULL/no-default columns on insert even if not requested, excluding the primary key', () => {
    const form = buildFormSpec('products', 'insert', [], {}, undefined, productColumns, productConstraints, enums);
    const names = form.fields.map((f) => f.name).sort();
    // name/price/category_id/status are NOT NULL with no default; id has a default (excluded as
    // PK too); notes is nullable; created_at has a default.
    expect(names).toEqual(['category_id', 'name', 'price', 'status']);
  });

  it('does not force-include columns on update — only what was requested', () => {
    const form = buildFormSpec(
      'products',
      'update',
      ['price'],
      {},
      { id: 'row-1' },
      productColumns,
      productConstraints,
      enums,
    );
    expect(form.fields.map((f) => f.name)).toEqual(['price']);
    expect(form.match).toEqual({ id: 'row-1' });
  });

  it('maps an enum-typed column to select with its allowed values', () => {
    const form = buildFormSpec('products', 'insert', [], {}, undefined, productColumns, productConstraints, enums);
    const status = form.fields.find((f) => f.name === 'status');
    expect(status?.type).toBe('select');
    expect(status?.options).toEqual([
      { value: 'active', label: 'active' },
      { value: 'discontinued', label: 'discontinued' },
    ]);
  });

  it('maps a single-column FK to foreign_key with the parsed reference table', () => {
    const form = buildFormSpec('products', 'insert', [], {}, undefined, productColumns, productConstraints, enums);
    const categoryField = form.fields.find((f) => f.name === 'category_id');
    expect(categoryField?.type).toBe('foreign_key');
    expect(categoryField?.referenceTable).toBe('categories');
    expect(categoryField?.referenceLabelColumn).toBe('name');
  });

  it('only sets default from known_values, never from a DB column default', () => {
    const form = buildFormSpec(
      'products',
      'insert',
      ['created_at'],
      { name: 'Widget' },
      undefined,
      productColumns,
      productConstraints,
      enums,
    );
    expect(form.fields.find((f) => f.name === 'name')?.default).toBe('Widget');
    // created_at has a DB default (now()) but no known_value was supplied for it.
    expect(form.fields.find((f) => f.name === 'created_at')?.default).toBeUndefined();
  });

  it('drops requested column names that are not real columns of the table', () => {
    const form = buildFormSpec(
      'products',
      'update',
      ['not_a_real_column', 'price'],
      {},
      { id: 'row-1' },
      productColumns,
      productConstraints,
      enums,
    );
    expect(form.fields.map((f) => f.name)).toEqual(['price']);
  });
});

describe('findMissingRequiredFields', () => {
  it('flags an empty/missing required field', () => {
    const missing = findMissingRequiredFields('products', { name: 'Widget', price: '' }, productColumns, productConstraints);
    expect(missing).toEqual(expect.arrayContaining(['price', 'category_id', 'status']));
    expect(missing).not.toContain('name');
  });

  it('never flags the primary key or nullable/defaulted columns', () => {
    const missing = findMissingRequiredFields(
      'products',
      { name: 'Widget', price: 100, category_id: 'cat-1', status: 'active' },
      productColumns,
      productConstraints,
    );
    expect(missing).toEqual([]);
  });
});

describe('findUnknownFields', () => {
  it('rejects a field name that is not a real column', () => {
    expect(findUnknownFields('products', { name: 'Widget', bogus: 1 }, productColumns)).toEqual(['bogus']);
  });

  it('accepts only real column names', () => {
    expect(findUnknownFields('products', { name: 'Widget', price: 100 }, productColumns)).toEqual([]);
  });
});
