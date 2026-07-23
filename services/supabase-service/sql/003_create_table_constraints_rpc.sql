-- SECURITY DEFINER RPC so tool-service (using the Supabase secret key) can read
-- Postgres's own pg_constraint catalog. PostgREST's OpenAPI schema only exposes
-- column name/type/nullable — it never reports constraints (PK, FK, UNIQUE,
-- CHECK), so this is the only way to get them.
create or replace function public.get_table_constraints()
returns table (
    table_name text,
    constraint_name text,
    constraint_type text,
    definition text
)
language sql
security definer
set search_path = public
as $$
    select
        t.relname as table_name,
        c.conname as constraint_name,
        c.contype as constraint_type,
        pg_get_constraintdef(c.oid) as definition
    from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    join pg_namespace n on t.relnamespace = n.oid
    where n.nspname = 'public'
    order by t.relname, c.conname;
$$;

grant execute on function public.get_table_constraints() to anon, authenticated, service_role;
