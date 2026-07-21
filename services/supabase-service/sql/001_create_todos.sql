-- Example schema for the "todo" artifact, exercising supabase-service's generic
-- /data/:table endpoints (which work against any table, not just this one).
-- Run this once in your Supabase project's SQL editor (or via the CLI) before
-- using the todo artifact — and follow the same create-table + enable RLS +
-- one-policy-per-operation pattern for any other table you want an artifact
-- to read/write through the same layer.

create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  -- Defaults to the caller's own id, since callers of the generic /data/:table
  -- layer (including artifacts, mediated through the parent app) never send
  -- user_id explicitly — the layer doesn't know this column exists.
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists todos_user_id_idx on public.todos (user_id);

alter table public.todos enable row level security;

-- One policy per operation, each scoped to auth.uid() = user_id, so a user's
-- Supabase access token (forwarded by supabase-service) can only ever see or
-- change their own rows — this is the actual authorization boundary, not the
-- application code.

create policy "Users can view their own todos"
  on public.todos for select
  using (auth.uid() = user_id);

create policy "Users can insert their own todos"
  on public.todos for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own todos"
  on public.todos for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own todos"
  on public.todos for delete
  using (auth.uid() = user_id);

-- Keep updated_at current on every write.
create or replace function public.set_todos_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists todos_set_updated_at on public.todos;
create trigger todos_set_updated_at
  before update on public.todos
  for each row
  execute function public.set_todos_updated_at();
