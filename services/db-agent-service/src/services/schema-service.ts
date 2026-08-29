import type { AppConfig } from '../config.js';
import type { SupabaseQueryClient } from './supabase-query-client.js';

export interface ColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: boolean;
  column_default: string | null;
  ordinal_position: number;
}

export interface ConstraintRow {
  table_name: string;
  constraint_name: string;
  constraint_type: string;
  definition: string;
}

export interface EnumRow {
  enum_name: string;
  enum_value: string;
}

/** Raw, still-structured schema data for a single table — what form-spec-builder.ts needs to
 *  build a FormSpec. A subset of the same rows describe()'s cache already holds; see getTableInfo. */
export interface TableSchemaInfo {
  columns: ColumnRow[];
  constraints: ConstraintRow[];
  enums: EnumRow[];
}

const FALLBACK_DESCRIPTION =
  'Schema lookup failed — no table/column names are currently known. Ask the user what data ' +
  'they mean (table/column names) before calling query_table or write_table, and treat any ' +
  'guesses as unverified.';

/**
 * Builds the "known tables and columns" section of the system prompt by reading the live
 * Supabase schema, instead of a hand-maintained copy that can silently drift from what's
 * actually deployed (see git history: schema-context.ts's old static listing was written from
 * packages/sql/01_create_tables.sql, an aspirational schema that turned out not to match this
 * project's real Supabase instance at all — every query failed until that was caught by hand).
 *
 * Reads three read-only Postgres catalog RPCs — get_schema_columns, get_table_constraints,
 * get_enum_values (services/supabase-service/sql/00[3-5]_*.sql) — through supabase-service's
 * generic /rpc/:function proxy, under the caller's own JWT. All three are SECURITY DEFINER and
 * granted to `anon`/`authenticated`, so — deliberately, matching this service's "holds no
 * Supabase key at all" design — no secret key is needed anywhere in this path, unlike opencode's
 * get_schema tool which reads the same kind of information but at artifact-generation time via a
 * secret key it's allowed to hold because it's never in a runtime request path.
 *
 * Schema metadata is identical for every caller (these RPCs read Postgres's own catalogs, not
 * RLS-governed application tables), so the result is cached process-wide for AppConfig.schemaCacheTtlMs
 * rather than per-user or per-request — short enough to notice a real schema change on its own
 * within a few minutes, long enough that an ordinary multi-turn chat doesn't re-fetch it every turn.
 */
interface Cache {
  description: string;
  columns: ColumnRow[];
  constraints: ConstraintRow[];
  enums: EnumRow[];
  expiresAt: number;
}

export class SchemaService {
  private cached: Cache | null = null;

  constructor(
    private readonly supabaseQuery: SupabaseQueryClient,
    private readonly config: AppConfig,
  ) {}

  async describe(jwt: string): Promise<string> {
    const cache = await this.ensureCache(jwt);
    return cache?.description ?? FALLBACK_DESCRIPTION;
  }

  /** Structured schema data for a single table — what form-spec-builder.ts needs to build a
   *  FormSpec. Shares the exact same cache/fetch path describe() uses, so calling this after (or
   *  before) describe() in the same turn doesn't trigger a second round of RPC calls. */
  async getTableInfo(jwt: string, table: string): Promise<TableSchemaInfo> {
    const cache = await this.ensureCache(jwt);
    if (!cache) {
      return { columns: [], constraints: [], enums: [] };
    }
    return {
      columns: cache.columns.filter((c) => c.table_name === table),
      constraints: cache.constraints.filter((c) => c.table_name === table),
      enums: cache.enums,
    };
  }

  private async ensureCache(jwt: string): Promise<Cache | null> {
    if (this.cached && this.cached.expiresAt > Date.now()) {
      return this.cached;
    }

    let columns: ColumnRow[];
    try {
      columns = await this.supabaseQuery.callRpc<ColumnRow[]>(jwt, 'get_schema_columns');
    } catch (err) {
      console.error('SchemaService.describe: get_schema_columns failed, serving fallback:', err);
      // Serve a stale-but-real cache over the generic fallback if we have one.
      return this.cached;
    }

    // Constraints and enum values are enrichment, not the core listing — degrade quietly (empty)
    // if either RPC migration hasn't been applied yet, rather than failing the whole lookup,
    // mirroring get_schema.ts's own fallback behavior for the same two RPCs.
    const [constraints, enums] = await Promise.all([
      this.supabaseQuery.callRpc<ConstraintRow[]>(jwt, 'get_table_constraints').catch((err) => {
        console.warn('SchemaService.describe: get_table_constraints unavailable:', err);
        return [] as ConstraintRow[];
      }),
      this.supabaseQuery.callRpc<EnumRow[]>(jwt, 'get_enum_values').catch((err) => {
        console.warn('SchemaService.describe: get_enum_values unavailable:', err);
        return [] as EnumRow[];
      }),
    ]);

    const description = formatSchema(columns, constraints, enums);
    this.cached = { description, columns, constraints, enums, expiresAt: Date.now() + this.config.schemaCacheTtlMs };
    console.log(`SchemaService.describe: refreshed live schema (${columns.length} column row(s) across the public schema)`);
    return this.cached;
  }
}

function formatSchema(columns: ColumnRow[], constraints: ConstraintRow[], enums: EnumRow[]): string {
  if (columns.length === 0) {
    return 'No tables are currently exposed in the public schema.';
  }

  const constraintsByTable = groupBy(constraints, (c) => c.table_name);
  const enumValuesByType = new Map<string, string[]>();
  for (const row of enums) {
    const list = enumValuesByType.get(row.enum_name) ?? [];
    list.push(row.enum_value);
    enumValuesByType.set(row.enum_name, list);
  }
  const columnsByTable = groupBy(columns, (c) => c.table_name);

  const lines: string[] = [];
  for (const [table, cols] of columnsByTable) {
    const columnText = cols
      .map((col) => {
        // information_schema reports an enum column's data_type as the unhelpful literal
        // "USER-DEFINED" — udt_name is the actual type name (e.g. "user_role"), both for display
        // and for matching against get_enum_values' enum_name.
        const displayType = col.data_type === 'USER-DEFINED' ? col.udt_name : col.data_type;
        const enumValues = enumValuesByType.get(col.udt_name);
        const enumSuffix = enumValues?.length ? `, allowed: ${enumValues.join(', ')}` : '';
        return `${col.column_name} (${displayType}${col.is_nullable ? ', nullable' : ''}${enumSuffix})`;
      })
      .join(', ');
    lines.push(`- ${table}: ${columnText}`);
    for (const constraint of constraintsByTable.get(table) ?? []) {
      lines.push(`    CONSTRAINT — ${constraint.constraint_name}: ${constraint.definition}`);
    }
  }

  return (
    'Known tables and columns (CONSTRAINT lines are PRIMARY KEY / FOREIGN KEY / UNIQUE / CHECK ' +
    "constraints, plus enum-typed columns' allowed values — any row you write must satisfy every " +
    'listed constraint for that table):\n' +
    lines.join('\n')
  );
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k) ?? [];
    list.push(row);
    map.set(k, list);
  }
  return map;
}
