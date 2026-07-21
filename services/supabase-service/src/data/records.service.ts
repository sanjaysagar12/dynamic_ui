import type { SupabaseClientFactory } from '../supabase/supabase-client-factory.js';
import { SupabaseRequestError } from '../core/errors.js';

const TABLE_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function assertValidTableName(table: string): void {
  if (!TABLE_NAME_PATTERN.test(table)) {
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

  async list(accessToken: string, table: string, filters: Record<string, string>): Promise<unknown[]> {
    assertValidTableName(table);
    const client = this.clientFactory.createUserScopedClient(accessToken);

    let query = client.from(table).select('*');
    for (const [column, value] of Object.entries(filters)) {
      query = query.eq(column, value);
    }

    const { data, error } = await query;
    if (error) {
      throw new SupabaseRequestError(error.message, 400);
    }
    return data ?? [];
  }

  async create(accessToken: string, table: string, payload: Record<string, unknown>): Promise<unknown> {
    assertValidTableName(table);
    const client = this.clientFactory.createUserScopedClient(accessToken);

    const { data, error } = await client.from(table).insert(payload).select().single();
    if (error) {
      throw new SupabaseRequestError(error.message, 400);
    }
    return data;
  }

  async update(accessToken: string, table: string, id: string, patch: Record<string, unknown>): Promise<unknown> {
    assertValidTableName(table);
    const client = this.clientFactory.createUserScopedClient(accessToken);

    const { data, error } = await client.from(table).update(patch).eq('id', id).select().single();
    if (error) {
      throw new SupabaseRequestError(error.message, 400);
    }
    return data;
  }

  async remove(accessToken: string, table: string, id: string): Promise<void> {
    assertValidTableName(table);
    const client = this.clientFactory.createUserScopedClient(accessToken);

    const { error } = await client.from(table).delete().eq('id', id);
    if (error) {
      throw new SupabaseRequestError(error.message, 400);
    }
  }
}
