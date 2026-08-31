-- ═══════════════════════════════════════════════════════════════════
--  VIJAYA ELECTRONICS ERP — RLS QUEST (Supabase)
--  Run this THIRD, after 01_create_quest.sql and 02_guard_quest.sql.
--
--  ASSUMPTIONS (state these to yourself before running — they're the
--  load-bearing design decisions of this file):
--
--  1. public.users.id is the SAME uuid as auth.users.id. i.e. when a
--     person signs up in Supabase Auth, you insert a matching row into
--     public.users with id = auth.uid() and the correct `role`.
--  2. Only two roles exist app-side: OWNER and STOREKEEPER (matches
--     the user_role enum). Anyone authenticated but with no matching
--     public.users row is treated as having no access.
--  3. Your backend/agent talks to Postgres using the Supabase
--     `service_role` key for system-level writes (number series,
--     balance maintenance, audit logging) — service_role BYPASSES RLS
--     entirely by default in Supabase, so those paths are unaffected
--     by anything below.
--  4. Anonymous (unauthenticated) access is NOT granted anywhere.
--  5. Normal user writes (create_material, issue_material, etc.) go
--     through supabase-service using the CALLER's own JWT/access
--     token — not service_role — per dynamic_ui's no-new-secret-key
--     architecture. This means every "any staff" write path below
--     must actually be reachable under RLS as `authenticated`. See
--     the FIX LOG for the two places this broke.
--
--  If your auth model differs (e.g. Supabase Auth user id != app user
--  id, or you use custom JWT claims for role), change only the
--  `app_user_id()` / `app_role()` functions below — every policy is
--  built on top of those two.
--
--  FIX LOG (this revision):
--   - settings_select added: settings was previously OWNER-only for
--     every operation, but create_purchase_order (any staff) must
--     read Setting['po.approval_threshold_inr'] to decide
--     PENDING_APPROVAL vs APPROVED. Writes remain owner-only.
--   - movements_insert now blocks type = 'REVERSAL' for non-owners.
--     The tool catalog marks reverse_movement as owner-only and
--     destructive, but the original policy only checked
--     is_authenticated_staff() with no per-type gate — the one
--     owner-only write path in the whole system that was resting on
--     tool-layer trust alone. Mirrors the pattern already used for
--     purchase_orders / stock_counts (staff can't reach the
--     owner-gated status/type on their own).
--   - Corresponding balance-trigger fix (SECURITY DEFINER) lives in
--     02_guard_quest.sql — stock_balances' policies below are
--     unchanged and correct; the bug was in how the trigger executed,
--     not in these policies.
-- ═══════════════════════════════════════════════════════════════════

-- ── 0. Helper functions ─────────────────────────────────────────────
-- SECURITY DEFINER + a fixed search_path so these can be called from
-- inside RLS policies (including on the users table itself) without
-- infinite recursion or search-path hijacking.

create or replace function app_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid();
$$;

create or replace function app_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.users where id = auth.uid();
$$;

create or replace function is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app_role() = 'OWNER';
$$;

create or replace function is_authenticated_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app_role() is not null;
$$;

-- ── 0b. Base privileges ──────────────────────────────────────────────
-- RLS policies only narrow down rows within an operation Postgres has
-- already decided the role may attempt — they are NOT a substitute for
-- the underlying GRANT. A role with no USAGE on this schema (or no
-- SELECT/INSERT/UPDATE/DELETE on a table) is rejected before RLS is
-- ever consulted, surfacing as "permission denied for schema public" /
-- "permission denied for relation <table>" instead of an empty result
-- set. `authenticated` is the Postgres role Supabase/PostgREST executes
-- a logged-in user's queries as (see supabase-service's
-- createUserScopedClient) — it needs these grants for every policy
-- above to ever run at all. `anon` is deliberately NOT granted
-- anything here: sign-up/sign-in go through Supabase's own `auth`
-- schema, not this one, and every table below requires
-- is_authenticated_staff() regardless, so an anonymous grant would be
-- dead weight.
grant usage on schema public to authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;
-- Safe even for append-only tables (stock_movements, audit_events):
-- they intentionally have no UPDATE/DELETE policy, so RLS still denies
-- those operations outright — this GRANT only opens the door RLS then
-- guards, it doesn't override anything above.

-- Lets the helper functions above actually be called by `authenticated`
-- — normally implicit (EXECUTE defaults to PUBLIC), made explicit here
-- since everything else in this file is.
grant execute on function app_user_id(), app_role(), is_owner(), is_authenticated_staff() to authenticated;

-- New tables added later won't inherit the grant above automatically —
-- this makes anything this same role creates from now on do so too.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

-- ── 1. Enable RLS everywhere ─────────────────────────────────────────
alter table users                enable row level security;
alter table parties              enable row level security;
alter table settings             enable row level security;
alter table number_series        enable row level security;
alter table materials            enable row level security;
alter table stock_balances       enable row level security;
alter table lots                 enable row level security;
alter table customer_pos         enable row level security;
alter table jobs                 enable row level security;
alter table job_bom_lines        enable row level security;
alter table purchase_orders      enable row level security;
alter table purchase_order_lines enable row level security;
alter table goods_receipts       enable row level security;
alter table goods_receipt_lines  enable row level security;
alter table stock_counts         enable row level security;
alter table stock_count_lines    enable row level security;
alter table scrap_sales          enable row level security;
alter table stock_movements      enable row level security;
alter table audit_events         enable row level security;
alter table notifications        enable row level security;
alter table attachments          enable row level security;

-- Force RLS even for the table owner role (defence in depth; service_role
-- still bypasses this, which is what you want for backend/agent writes).
alter table users                force row level security;
alter table stock_movements      force row level security;
alter table audit_events         force row level security;

-- ── 2. users ─────────────────────────────────────────────────────────
-- Everyone can see the staff directory (needed for "who counted this",
-- "who approved this" lookups). Only OWNER edits roles/deactivates staff.
-- A person may update their own contact fields (name/phone) — not role.

create policy users_select_all on users
  for select using (is_authenticated_staff());

create policy users_owner_write on users
  for insert with check (is_owner());

create policy users_owner_update on users
  for update using (is_owner()) with check (is_owner());

create policy users_self_update on users
  for update using (id = app_user_id())
  with check (id = app_user_id() and role = (select role from users u where u.id = app_user_id()));

create policy users_owner_delete on users
  for delete using (is_owner());

-- ── 3. parties, materials, number_series ────────────────────────────
-- Read: any staff. Write masters: any staff may create/update (they're
-- doing data entry), but deactivation-only — no hard delete for anyone
-- except OWNER, matching "masters deactivate, never delete."

create policy parties_select on parties for select using (is_authenticated_staff());
create policy parties_write  on parties for insert with check (is_authenticated_staff());
create policy parties_update on parties for update using (is_authenticated_staff()) with check (is_authenticated_staff());
create policy parties_owner_delete on parties for delete using (is_owner());

create policy materials_select on materials for select using (is_authenticated_staff());
create policy materials_write  on materials for insert with check (is_authenticated_staff());
create policy materials_update on materials for update using (is_authenticated_staff()) with check (is_authenticated_staff());
create policy materials_owner_delete on materials for delete using (is_owner());

create policy numseries_select on number_series for select using (is_authenticated_staff());
create policy numseries_write  on number_series for all using (is_authenticated_staff()) with check (is_authenticated_staff());

-- ── 4. settings ──────────────────────────────────────────────────────
-- Business-rule knobs (approval thresholds etc). Writes stay OWNER
-- only. Reads are opened to all staff: create_purchase_order (any
-- staff, per the tool catalog) must read
-- Setting['po.approval_threshold_inr'] at call time to decide
-- PENDING_APPROVAL vs APPROVED — under the caller's own JWT, an
-- owner-only SELECT policy would make that read return nothing for a
-- STOREKEEPER and silently break the threshold check.

create policy settings_select on settings
  for select using (is_authenticated_staff());

create policy settings_owner_write on settings
  for insert with check (is_owner());

create policy settings_owner_update on settings
  for update using (is_owner()) with check (is_owner());

create policy settings_owner_delete on settings
  for delete using (is_owner());

-- ── 5. stock_balances, lots ──────────────────────────────────────────
-- Balance is DERIVED — nobody writes it directly, ever. The trigger in
-- 02_guard_quest.sql (apply_stock_movement / create_balance_row) is
-- SECURITY DEFINER specifically so it can write here despite
-- `authenticated` having no INSERT/UPDATE policy on this table — do
-- not "fix" that by adding a broad write policy here; that would let
-- any staff (or a compromised agent call) overwrite balances directly,
-- bypassing the weighted-average math and the ledger entirely.

create policy balances_select on stock_balances for select using (is_authenticated_staff());
-- Deliberately NO insert/update/delete policy for authenticated roles.
-- Only the SECURITY DEFINER trigger functions and service_role can
-- change this table.

create policy lots_select on lots for select using (is_authenticated_staff());
create policy lots_write  on lots for insert with check (is_authenticated_staff());
create policy lots_update on lots for update using (is_authenticated_staff()) with check (is_authenticated_staff());

-- ── 6. jobs, customer_pos, job_bom_lines ─────────────────────────────
-- Note: job_bom_lines' qtyPerPiece/requiredQty are additionally locked
-- to job.status = 'OPEN' by trg_guard_bom_lock in 02_guard_quest.sql.
-- These RLS policies stay permissive on "any staff" for INSERT/UPDATE
-- because issuedQty/returnedQty (written by issue_material /
-- return_material) must remain writable at MATERIAL_ISSUED too — the
-- status-aware distinction is handled at the trigger level, not here.

create policy custpo_select on customer_pos for select using (is_authenticated_staff());
create policy custpo_write  on customer_pos for insert with check (is_authenticated_staff());
create policy custpo_update on customer_pos for update using (is_authenticated_staff()) with check (is_authenticated_staff());

create policy jobs_select on jobs for select using (is_authenticated_staff());
create policy jobs_write  on jobs for insert with check (is_authenticated_staff());
create policy jobs_update on jobs for update using (is_authenticated_staff()) with check (is_authenticated_staff());

create policy bom_select on job_bom_lines for select using (is_authenticated_staff());
create policy bom_write  on job_bom_lines for insert with check (is_authenticated_staff());
create policy bom_update on job_bom_lines for update using (is_authenticated_staff()) with check (is_authenticated_staff());

-- ── 7. purchasing ─────────────────────────────────────────────────────
-- STOREKEEPER can draft a PO and record GRNs. Only OWNER can move a PO
-- into APPROVED (or REJECTED) status — enforced here on top of whatever
-- the tool layer already checks, per "the database is the line that
-- cannot be argued with."

create policy po_select on purchase_orders for select using (is_authenticated_staff());

create policy po_insert on purchase_orders for insert
  with check (is_authenticated_staff() and status in ('DRAFT','PENDING_APPROVAL'));

create policy po_update_staff on purchase_orders for update
  using (is_authenticated_staff() and status in ('DRAFT','PENDING_APPROVAL'))
  with check (status in ('DRAFT','PENDING_APPROVAL','CANCELLED'));

create policy po_update_owner on purchase_orders for update
  using (is_owner())
  with check (is_owner());

create policy pol_select on purchase_order_lines for select using (is_authenticated_staff());
create policy pol_write  on purchase_order_lines for insert with check (is_authenticated_staff());
create policy pol_update on purchase_order_lines for update using (is_authenticated_staff()) with check (is_authenticated_staff());

create policy grn_select on goods_receipts for select using (is_authenticated_staff());
create policy grn_write  on goods_receipts for insert with check (is_authenticated_staff());

create policy grl_select on goods_receipt_lines for select using (is_authenticated_staff());
create policy grl_write  on goods_receipt_lines for insert with check (is_authenticated_staff());

-- ── 8. physical count ──────────────────────────────────────────────
-- STOREKEEPER can create/edit a count while it's DRAFT or was REJECTED
-- (to resubmit). Only OWNER can move it to APPROVED/REJECTED — this is
-- the row-level backstop for the "owner approval required" rule that
-- 02_guard_quest.sql's trigger already enforces for the resulting
-- COUNT_ADJUSTMENT movement.

create policy counts_select on stock_counts for select using (is_authenticated_staff());

create policy counts_insert on stock_counts for insert
  with check (is_authenticated_staff() and status in ('DRAFT'));

create policy counts_update_staff on stock_counts for update
  using (is_authenticated_staff() and status in ('DRAFT','REJECTED'))
  with check (status in ('DRAFT','PENDING_APPROVAL'));

create policy counts_update_owner on stock_counts for update
  using (is_owner())
  with check (is_owner());

create policy count_lines_select on stock_count_lines for select using (is_authenticated_staff());
create policy count_lines_write  on stock_count_lines for insert with check (is_authenticated_staff());
create policy count_lines_update on stock_count_lines for update using (is_authenticated_staff()) with check (is_authenticated_staff());

-- ── 9. scrap ─────────────────────────────────────────────────────────

create policy scrap_select on scrap_sales for select using (is_authenticated_staff());
create policy scrap_write  on scrap_sales for insert with check (is_authenticated_staff());

-- ── 10. stock_movements — the ledger ─────────────────────────────────
-- Read: any staff. Insert: any staff, EXCEPT type = 'REVERSAL', which
-- is owner-only (reverse_movement is marked owner-only + destructive
-- in the tool catalog). Every other guard (job required, approved
-- count required, balance maths, append-only) still comes from the
-- triggers in 02_guard_quest.sql. NO update/delete policy is defined
-- for ANY role: combined with `force row level security` and the
-- append-only triggers, this table cannot be altered or erased by
-- anyone talking through the API, human or agent.

create policy movements_select on stock_movements for select using (is_authenticated_staff());

create policy movements_insert on stock_movements for insert
  with check (
    is_authenticated_staff()
    and (type <> 'REVERSAL' or is_owner())
  );
-- No UPDATE/DELETE policy → those operations are rejected by RLS
-- before they even reach the append-only triggers.

-- ── 11. audit_events — same append-only treatment ────────────────────

create policy audit_select on audit_events for select using (is_authenticated_staff());
create policy audit_insert on audit_events for insert with check (is_authenticated_staff());
-- No UPDATE/DELETE policy here either.

-- ── 12. notifications ─────────────────────────────────────────────────
-- A user only sees and manages their own notifications. Any authenticated
-- staff process (or service_role) can create them for someone else.

create policy notif_select_own on notifications
  for select using ("userId" = app_user_id());

create policy notif_insert on notifications
  for insert with check (is_authenticated_staff());

create policy notif_update_own on notifications
  for update using ("userId" = app_user_id())
  with check ("userId" = app_user_id());

-- ── 13. attachments ────────────────────────────────────────────────────

create policy attach_select on attachments for select using (is_authenticated_staff());
create policy attach_insert on attachments for insert with check (is_authenticated_staff());

-- ═══════════════════════════════════════════════════════════════════
-- NOTE ON COLUMN-LEVEL SECRECY:
-- The schema comment says materials.code must never be shown to the
-- storekeeper. RLS is ROW-level, not column-level, so it cannot hide
-- one column from one role while showing the rest of the row. Handle
-- that with a view instead, e.g.:
--
--   create view materials_storekeeper as
--     select id, name, uom, "stockType", "minimumLevel", "isActive"
--     from materials;
--
-- ...and point the storekeeper-facing client/tool at that view (or a
-- SECURITY INVOKER view, Postgres 15+) instead of the base table.
-- ═══════════════════════════════════════════════════════════════════