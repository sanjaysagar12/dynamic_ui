-- SECURITY DEFINER RPC so any authenticated caller (via the anon key + their own JWT — no
-- secret key needed, same as 003_create_table_constraints_rpc.sql and
-- 004_create_enum_values_rpc.sql) can read Postgres's own information_schema for the public
-- schema. Together, these three RPCs are what services/db-agent-service/src/services/schema-
-- service.ts uses to build a live schema description for its chat agent, instead of a
-- hand-maintained copy that can silently drift from what's actually deployed.
--
-- `udt_name` is included alongside the human-readable `data_type` because for a user-defined
-- (enum) column, `data_type` just says "USER-DEFINED" — `udt_name` is the actual Postgres type
-- name (e.g. "user_role"), which is what 004_create_enum_values_rpc.sql's `enum_name` matches
-- against to report that column's allowed values.
create or replace function public.get_schema_columns()
returns table (
    table_name text,
    column_name text,
    data_type text,
    udt_name text,
    is_nullable boolean,
    column_default text,
    ordinal_position int
)
language sql
security definer
set search_path = public
as $$
    select
        c.table_name,
        c.column_name,
        c.data_type,
        c.udt_name,
        (c.is_nullable = 'YES') as is_nullable,
        c.column_default,
        c.ordinal_position
    from information_schema.columns c
    where c.table_schema = 'public'
    order by c.table_name, c.ordinal_position;
$$;

grant execute on function public.get_schema_columns() to anon, authenticated, service_role;
