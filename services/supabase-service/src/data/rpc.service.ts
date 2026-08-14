import type { SupabaseClientFactory } from '../supabase/supabase-client-factory.js';
import { SupabaseRequestError } from '../core/errors.js';

// Same shape of validation as records.service.ts's table names — reject obviously-malformed
// input before it ever reaches Postgres, not an authorization check (GRANT/RLS on the Postgres
// side is what actually decides whether the *named* function can be called by this caller).
const FUNCTION_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function assertValidFunctionName(fn: string): void {
  if (!FUNCTION_NAME_PATTERN.test(fn)) {
    console.warn(`RpcService: rejected invalid function name "${fn}"`);
    throw new SupabaseRequestError(`Invalid function name: ${fn}`, 400);
  }
}

/**
 * A schema-agnostic proxy over `supabase.rpc(<any function>, <args>)` — the RPC counterpart to
 * RecordsService's table proxy. Exists because some things Postgres can do (reading its own
 * catalogs for schema introspection, in particular) aren't expressible as a `/data/:table`
 * request at all; they have to be a Postgres function call.
 *
 * This does NOT itself enforce who can call what — same as RecordsService, that's entirely
 * Postgres's job (GRANT EXECUTE ... TO ..., and RLS on whatever tables the function queries,
 * unless the function is SECURITY DEFINER, in which case *it* is the thing responsible for only
 * doing something safe to expose broadly — see services/supabase-service/sql/00[3-5]_*.sql for
 * the three RPCs this system currently relies on, all deliberately narrow read-only catalog
 * lookups). This proxy just forwards the call under the caller's own access token, same as every
 * other Supabase access path in this service.
 */
export class RpcService {
  constructor(private readonly clientFactory: SupabaseClientFactory) {}

  async call(accessToken: string, fn: string, args: Record<string, unknown>): Promise<unknown> {
    assertValidFunctionName(fn);
    const client = this.clientFactory.createUserScopedClient(accessToken);

    const { data, error } = await client.rpc(fn, args);
    if (error) {
      console.error(`RpcService.call: rpc "${fn}" failed:`, error.message);
      throw new SupabaseRequestError(error.message, 400);
    }
    const rowCount = Array.isArray(data) ? data.length : 1;
    console.log(`RpcService.call: rpc "${fn}" -> ${rowCount} row(s)`);
    return data;
  }
}
