// A static description of the known Supabase schema — the only schema knowledge this agent has.
// Unlike opencode's get_schema tool (services/artifacts-server/artifacts/.opencode/tool/get_schema.ts),
// this service is never given a Supabase secret key, so it can't introspect the schema live at
// request time; it only ever reads/writes through supabase-service under the caller's own JWT.
//
// NOTE: packages/sql/*.sql describes a much larger aspirational ERP schema (materials, jobs,
// purchase_orders, etc.) that is NOT what's actually deployed on this project's live Supabase
// instance — querying those table names fails with "Could not find the table in the schema
// cache". The listing below was captured directly from the live project's PostgREST OpenAPI
// document (the same source get_schema.ts reads), not from packages/sql. Keep this in sync by
// hand if the live schema changes.
export const DB_SCHEMA_CONTEXT = `
Known tables and their columns (all in the public schema; column names are case-sensitive):

- users(id, full_name, role["OWNER"|"STOREKEEPER"], created_at)
- categories(id, name, created_at)
- products(id, sku, name, category_id -> categories.id, quantity, unit_price, created_by -> users.id, created_at, updated_at)
- stock_transactions(id, product_id -> products.id, change_qty, reason, performed_by -> users.id, created_at)

Every table has Row-Level Security enabled. The caller's own Supabase role (OWNER or
STOREKEEPER) determines what rows they can actually see or change — you are never told which
role the caller has, and you must not guess or ask. Query/write normally; Postgres silently
filters out rows the caller isn't allowed to see (for reads) or rejects writes the caller isn't
allowed to make (for writes). An empty read result can mean either "no such rows exist" or "they
exist but aren't visible to this caller" — these look identical to you and MUST be treated
identically in your answer. Never speculate about permissions, never say things like "that data
exists but you don't have access", and never suggest the caller use a different account or ask
someone else to bypass the restriction. If a query comes back empty, just say you couldn't find
matching records. If a write is rejected, say the change couldn't be made — don't speculate about
whether that's a permissions issue or something else.
`.trim();
