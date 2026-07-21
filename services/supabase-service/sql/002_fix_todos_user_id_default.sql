-- If you ran 001_create_todos.sql before it had `default auth.uid()` on
-- user_id, your table already existed by the time that fix landed —
-- `create table if not exists` is a no-op against an existing table, so it
-- silently skipped applying the new default. That's why inserts fail with
-- "new row violates row-level security policy for table \"todos\"": user_id
-- comes through as NULL, and `auth.uid() = NULL` evaluates to NULL, which
-- RLS treats as "not satisfied".
--
-- Run this once against your existing table to add the default retroactively.
-- Safe to run even if 001 already applied it (ALTER ... SET DEFAULT is idempotent).

alter table public.todos alter column user_id set default auth.uid();
