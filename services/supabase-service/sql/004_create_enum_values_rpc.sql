-- SECURITY DEFINER RPC so tool-service/opencode's get_schema tool can report
-- every enum type's allowed values (e.g. "UserRole" -> OWNER, STOREKEEPER).
-- PostgREST's OpenAPI document reports an enum column's *type name* (e.g.
-- `public."UserRole"`) but never its allowed values — this is the only way
-- to get them, the same way 003_create_table_constraints_rpc.sql is the only
-- way to get CHECK/PK/FK/UNIQUE constraints.
create or replace function public.get_enum_values()
returns table (
    enum_name text,
    enum_value text
)
language sql
security definer
set search_path = public
as $$
    select
        t.typname as enum_name,
        e.enumlabel as enum_value
    from pg_type t
    join pg_enum e on t.oid = e.enumtypid
    join pg_namespace n on t.typnamespace = n.oid
    where n.nspname = 'public'
    order by t.typname, e.enumsortorder;
$$;

grant execute on function public.get_enum_values() to anon, authenticated, service_role;
