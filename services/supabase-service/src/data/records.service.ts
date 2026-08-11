import type { SupabaseClientFactory } from '../supabase/supabase-client-factory.js';
import { SupabaseRequestError } from '../core/errors.js';

// Table names come straight from the URL path (":table" in records.controller.ts), so this is
// the one thing this service validates itself rather than leaving entirely to Postgres/RLS —
// it's about rejecting obviously-malformed input early, not an authorization check (RLS is what
// actually decides whether the *named* table can be read/written by this caller).
const TABLE_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function assertValidTableName(table: string): void {
  if (!TABLE_NAME_PATTERN.test(table)) {
    console.warn(`RecordsService: rejected invalid table name "${table}"`);
    throw new SupabaseRequestError(`Invalid table name: ${table}`, 400);
  }
}

/**
 * A schema-agnostic proxy over `supabase.from(<any table>)`. Row-level
 * security on the Postgres side — not this service — is what actually scopes
 * a caller to their own data; this class just forwards to whichever table
 * the caller names, under the access token they supply.
 */
export class RecordsService {
  constructor(private readonly clientFactory: SupabaseClientFactory) {}

  /** GET /data/:table — list rows, optionally filtered/sorted/limited. `params` is the raw
   *  query string, already reduced to string-only values by records.controller.ts. */
  async list(accessToken: string, table: string, params: Record<string, string>): Promise<unknown[]> {
    assertValidTableName(table);
    const client = this.clientFactory.createUserScopedClient(accessToken);

    // "order" and "limit" are query modifiers (PostgREST convention), not
    // column filters — every other key is treated as an `column = value` filter.
    const { order, limit, ...filters } = params;

    let query = client.from(table).select('*');
    for (const [column, value] of Object.entries(filters)) {
      query = query.eq(column, value);
    }

    if (order) {
      const [column, direction] = order.split('.');
      query = query.order(column, { ascending: direction !== 'desc' });
    }

    if (limit) {
      const parsedLimit = Number(limit);
      if (Number.isFinite(parsedLimit)) {
        query = query.limit(parsedLimit);
      }
    }

    const { data, error } = await query;
    if (error) {
      // Deliberately not distinguished from "no matching rows" at this layer — a 400 here
      // means the query itself was rejected (bad column, RLS-adjacent Postgres error), not
      // that RLS silently filtered rows out. RLS-filtered reads still return { data: [] }, 200.
      console.error(`RecordsService.list: query failed on table "${table}":`, error.message);
      throw new SupabaseRequestError(error.message, 400);
    }
    console.log(`RecordsService.list: table="${table}" filters=${JSON.stringify(filters)} -> ${data?.length ?? 0} row(s)`);
    return data ?? [];
  }

  /** POST /data/:table — insert one row and return it. `.select().single()` both fetches the
   *  inserted row back (Postgres doesn't return it by default) and turns "0 or >1 rows" into
   *  an error, which shouldn't be reachable for a single-object insert but fails loudly if it is. */
  async create(accessToken: string, table: string, payload: Record<string, unknown>): Promise<unknown> {
    assertValidTableName(table);
    const client = this.clientFactory.createUserScopedClient(accessToken);

    const { data, error } = await client.from(table).insert(payload).select().single();
    if (error) {
      console.error(`RecordsService.create: insert failed on table "${table}":`, error.message);
      throw new SupabaseRequestError(error.message, 400);
    }
    console.log(`RecordsService.create: table="${table}" -> created row ${(data as { id?: string })?.id ?? '(no id)'}`);
    return data;
  }

  /** PATCH /data/:table/:id — update one row by its `id` column and return the new state. */
  async update(accessToken: string, table: string, id: string, patch: Record<string, unknown>): Promise<unknown> {
    assertValidTableName(table);
    const client = this.clientFactory.createUserScopedClient(accessToken);

    const { data, error } = await client.from(table).update(patch).eq('id', id).select().single();
    if (error) {
      console.error(`RecordsService.update: update failed on table "${table}" id=${id}:`, error.message);
      throw new SupabaseRequestError(error.message, 400);
    }
    console.log(`RecordsService.update: table="${table}" id=${id} -> updated`);
    return data;
  }

  /** DELETE /data/:table/:id — delete one row by its `id` column. No content is returned on
   *  success, matching the 204 the controller replies with. */
  async remove(accessToken: string, table: string, id: string): Promise<void> {
    assertValidTableName(table);
    const client = this.clientFactory.createUserScopedClient(accessToken);

    const { error } = await client.from(table).delete().eq('id', id);
    if (error) {
      console.error(`RecordsService.remove: delete failed on table "${table}" id=${id}:`, error.message);
      throw new SupabaseRequestError(error.message, 400);
    }
    console.log(`RecordsService.remove: table="${table}" id=${id} -> deleted`);
  }
}
