import { ValidationError } from '../core/errors.js';
import type { ChatDbResponse, SubmitFormRequest } from '../schemas.js';
import { findMissingRequiredFields, findUnknownFields, humanizeLabel } from './form-spec-builder.js';
import type { SchemaService } from './schema-service.js';
import type { SupabaseQueryClient } from './supabase-query-client.js';

/**
 * Commits a write built from a form the user actually filled in and confirmed (see
 * db-chat-service.ts's request_form / FormSpec). Re-derives the live schema for the target table
 * and validates against it server-side — never trusts a client-supplied FormSpec's own
 * required/type flags, since the client payload isn't otherwise trusted here.
 */
export class FormCommitService {
  constructor(
    private readonly supabaseQuery: SupabaseQueryClient,
    private readonly schemaService: SchemaService,
  ) {}

  async submit(request: SubmitFormRequest): Promise<ChatDbResponse> {
    const { columns, constraints } = await this.schemaService.getTableInfo(request.jwt, request.table);
    if (columns.length === 0) {
      throw new ValidationError(`Unknown table "${request.table}" — it isn't in the known schema.`);
    }

    const unknownFields = findUnknownFields(request.table, request.values, columns);
    if (unknownFields.length > 0) {
      throw new ValidationError(`Unknown field(s) for table "${request.table}": ${unknownFields.join(', ')}`);
    }

    const missing = findMissingRequiredFields(request.table, request.values, columns, constraints);
    if (missing.length > 0) {
      throw new ValidationError(`Missing required field(s): ${missing.join(', ')}`);
    }

    const row =
      request.operation === 'insert'
        ? await this.supabaseQuery.createRow(request.jwt, request.table, request.values)
        : await this.supabaseQuery.updateRow(request.jwt, request.table, requireMatchId(request), request.values);

    const content = buildConfirmation(request, row);
    return {
      type: 'text',
      content,
      messages: [...request.messages, { role: 'assistant', content }],
    };
  }
}

function requireMatchId(request: SubmitFormRequest): string {
  if (!request.match?.id) {
    throw new ValidationError('match.id is required for operation "update"');
  }
  return request.match.id;
}

function buildConfirmation(request: SubmitFormRequest, row: unknown): string {
  const verb = request.operation === 'insert' ? 'Created' : 'Updated';
  const fieldSummary = Object.entries(request.values)
    .map(([name, value]) => `${humanizeLabel(name)}: ${formatValue(value)}`)
    .join(', ');
  const rowLabel = describeRow(row);
  return `${verb} ${rowLabel ? `**${rowLabel}**` : `the row`} in \`${request.table}\` (${fieldSummary}). Anything else?`;
}

function describeRow(row: unknown): string | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const label = r.name ?? r.title;
  return typeof label === 'string' ? label : null;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '(empty)';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}
