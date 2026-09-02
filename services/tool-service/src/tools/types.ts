import type { z } from 'zod';
import type { PrismaClient } from '@prisma/client';

export interface ToolContext {
  userId: string | null;
  email: string | null;
  role: string | null;
  prisma: PrismaClient;
}

export type ToolResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string };

export type FieldWidget =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'checkbox'
  | 'select'
  | 'foreign_key' // single reference, resolved via another tool
  | 'line_items'; // repeatable array of sub-fields (e.g. PO lines, BOM lines)

export interface FormFieldSpec {
  name: string; // matches the arg key (dot/bracket path for nested, e.g. "lines[].materialId")
  label: string;
  widget: FieldWidget;
  required: boolean;
  helpText?: string;
  defaultValue?: unknown;
  visibleIf?: { field: string; equals: unknown }; // conditional fields, e.g. minimumLevel only if stockType === 'STANDING'
  options?: { value: string; label: string }[]; // for 'select'
  foreignKey?: {
    tool: string; // tool to call for lookup/search, e.g. "search_materials"
    valueField: string; // field on the result to store as the arg value, e.g. "id"
    labelField: string; // field to display, e.g. "name"
    allowCreate?: boolean; // shows a "use this as new name" affordance, backed by resolveOrCreateByName tool-side
    // Static args merged into every call to `tool` alongside its live query
    // text — e.g. list_rows's required `table` (and an optional `where`)
    // when there's no dedicated search tool for the referenced entity yet.
    args?: Record<string, unknown>;
  };
  itemFields?: FormFieldSpec[]; // for 'line_items' — the shape of each repeated row
}

export interface FormSpec {
  title: string;
  fields: FormFieldSpec[];
  submitLabel?: string; // default "Submit"
  confirmationCopy?: string; // template shown above the form, e.g. for set_job_bom's high-stakes restatement
}

export interface TableColumnSpec {
  field: string;
  label: string;
  format?: 'text' | 'number' | 'currency' | 'date' | 'badge';
}

export type DisplaySpec =
  | { type: 'table'; columns: TableColumnSpec[]; highlightIf?: { field: string; op: 'gt' | 'lt' | 'neq'; value: unknown } }
  | { type: 'chart'; chartType: 'line' | 'bar'; xField: string; yField: string; seriesField?: string; title: string }
  | {
      type: 'card';
      fields: { field: string; label: string; format?: TableColumnSpec['format'] }[];
      // Renders one nested array field (e.g. get_job's bomLines) as a small
      // table below the card, so a card result can still show its line
      // items without inventing a second response type just for that.
      subTable?: { field: string; title?: string; columns: TableColumnSpec[] };
    };

export interface ToolDefinition<Args = any> {
  name: string;
  description: string;
  inputSchema: z.ZodType<Args>;
  requiresAuth?: boolean;
  requiredRoles?: string[];
  mutates: boolean;
  destructive?: boolean;
  form?: FormSpec; // present iff mutates: true
  display?: DisplaySpec; // present iff mutates: false
  handler: (ctx: ToolContext, args: Args) => Promise<ToolResult>;
}
