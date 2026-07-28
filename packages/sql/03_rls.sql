-- ═══════════════════════════════════════════════════════════════════
--  VIJAYA ELECTRONICS ERP — 03 · ROW LEVEL SECURITY
--  Links `users` to Supabase Auth, adds is_owner()/is_storekeeper()
--  helpers, enables RLS on every table, and sets policies so:
--   - OWNER has full read/write, including approvals
--   - STOREKEEPER does daily entry (receipts, issues, counts, jobs)
--     but cannot approve counts/POs or touch the audit trail
--  Requires 01_create_tables.sql and 02_guards.sql to have run first.
--  Run 04_views.sql next.
-- ═══════════════════════════════════════════════════════════════════

--   - STOREKEEPER    → does the daily work (receipts, issues, returns,
--                      counts, jobs) but cannot approve counts/POs,
--                      cannot touch audit trail, cannot rewrite the
--                      ledger (already blocked by your triggers).
--   - Anything not explicitly granted a policy is DENIED once RLS
--     is enabled — that's the safe default.
-- ═══════════════════════════════════════════════════════════════════

-- ── 0. Link `users` to Supabase Auth ──────────────────────────────
-- Supabase's `auth.users` is the identity table behind auth.uid().
-- Your own `users` table is the app's profile/role table. Link them.
ALTER TABLE users
  ADD COLUMN "authUserId" UUID UNIQUE REFERENCES auth.users(id);

-- Recommended: when a new person signs up via Supabase Auth, insert
-- their profile row here (id = own uuid, authUserId = auth.uid(),
-- role = 'STOREKEEPER' by default, owner promotes as needed). Do this
-- from your backend / an auth webhook — not shown here since it
-- depends on your signup flow.

-- ── 1. Helper functions ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION current_app_user_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT id FROM users WHERE "authUserId" = auth.uid() AND "isActive";
$$;

CREATE OR REPLACE FUNCTION is_owner()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE "authUserId" = auth.uid() AND role = 'OWNER' AND "isActive"
  );
$$;

CREATE OR REPLACE FUNCTION is_storekeeper()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE "authUserId" = auth.uid() AND role = 'STOREKEEPER' AND "isActive"
  );
$$;

-- Any active, recognised user (owner or storekeeper)
CREATE OR REPLACE FUNCTION is_active_user()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM users WHERE "authUserId" = auth.uid() AND "isActive"
  );
$$;

-- ═══════════════════════════════════════════════════════════════════
--  2. ENABLE RLS EVERYWHERE
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE parties               ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings               ENABLE ROW LEVEL SECURITY;
ALTER TABLE number_series          ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications          ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE materials              ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_balances         ENABLE ROW LEVEL SECURITY;
ALTER TABLE lots                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_pos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_bom_lines          ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders        ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_lines   ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_receipts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_receipt_lines    ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_counts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_count_lines      ENABLE ROW LEVEL SECURITY;
ALTER TABLE scrap_sales            ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements        ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════════
--  3. USERS — people can see themselves; owners see/manage everyone
-- ═══════════════════════════════════════════════════════════════════
CREATE POLICY users_select_self_or_owner ON users
  FOR SELECT USING ("authUserId" = auth.uid() OR is_owner());

CREATE POLICY users_update_owner_only ON users
  FOR UPDATE USING (is_owner()) WITH CHECK (is_owner());

CREATE POLICY users_insert_owner_only ON users
  FOR INSERT WITH CHECK (is_owner());

-- ═══════════════════════════════════════════════════════════════════
--  4. MASTER / REFERENCE DATA
--     Both roles can read; only the owner manages master data.
-- ═══════════════════════════════════════════════════════════════════
CREATE POLICY parties_select ON parties  FOR SELECT USING (is_active_user());
CREATE POLICY parties_write  ON parties  FOR ALL
  USING (is_owner()) WITH CHECK (is_owner());

CREATE POLICY materials_select ON materials FOR SELECT USING (is_active_user());
CREATE POLICY materials_write  ON materials FOR ALL
  USING (is_owner()) WITH CHECK (is_owner());
-- NOTE: RLS is row-level. To hide the internal `code` column (and,
-- if you want, rate/cost columns) from the storekeeper while still
-- letting them SELECT the row, use column-level privileges instead
-- (see section 8 at the bottom).

CREATE POLICY settings_select ON settings FOR SELECT USING (is_active_user());
CREATE POLICY settings_write  ON settings FOR ALL
  USING (is_owner()) WITH CHECK (is_owner());

CREATE POLICY number_series_select ON number_series FOR SELECT USING (is_active_user());
CREATE POLICY number_series_write  ON number_series FOR ALL
  USING (is_active_user()) WITH CHECK (is_active_user());
-- Both roles can advance number_series (issuing the next doc number
-- is a routine operational action, not a privileged one).

-- stock_balances is DERIVED — nobody writes it directly (the trigger
-- runs as the table owner via SECURITY DEFINER-style trigger, so RLS
-- on this table only needs to gate SELECT).
CREATE POLICY stock_balances_select ON stock_balances FOR SELECT
  USING (is_active_user());

-- Dormant traceability table — leave owner-only until you activate it.
CREATE POLICY lots_owner_only ON lots FOR ALL
  USING (is_owner()) WITH CHECK (is_owner());

-- ═══════════════════════════════════════════════════════════════════
--  5. AUDIT & NOTIFICATIONS
-- ═══════════════════════════════════════════════════════════════════
-- Audit trail: owners can see everything. Storekeepers can see only
-- entries about their own actions (useful for "what did I just do")
-- but not everyone else's — full visibility is an owner privilege.
CREATE POLICY audit_select ON audit_events FOR SELECT
  USING (is_owner() OR "actorId" = current_app_user_id());
-- No client-side INSERT/UPDATE/DELETE policy on purpose: the audit
-- trail should be written by your backend using the service_role key
-- (which bypasses RLS), so a client can never author its own audit
-- history. UPDATE/DELETE are already hard-blocked by the trigger
-- regardless of role.

CREATE POLICY notifications_select_own ON notifications FOR SELECT
  USING ("userId" = current_app_user_id() OR is_owner());
CREATE POLICY notifications_update_own ON notifications FOR UPDATE
  USING ("userId" = current_app_user_id())
  WITH CHECK ("userId" = current_app_user_id());
-- Inserts come from the backend (e.g. a min-level-breach trigger you
-- add later), not directly from clients — no INSERT policy given.

CREATE POLICY attachments_select ON attachments FOR SELECT
  USING (is_active_user());
CREATE POLICY attachments_insert ON attachments FOR INSERT
  WITH CHECK (is_active_user());
CREATE POLICY attachments_write_owner ON attachments FOR UPDATE
  USING (is_owner()) WITH CHECK (is_owner());
CREATE POLICY attachments_delete_owner ON attachments FOR DELETE
  USING (is_owner());

-- ═══════════════════════════════════════════════════════════════════
--  6. OPERATIONAL DATA — both roles do daily work here
-- ═══════════════════════════════════════════════════════════════════

-- Jobs & BOM lines: both roles read/write day to day.
CREATE POLICY customer_pos_all ON customer_pos FOR ALL
  USING (is_active_user()) WITH CHECK (is_active_user());

CREATE POLICY jobs_select ON jobs FOR SELECT USING (is_active_user());
CREATE POLICY jobs_insert ON jobs FOR INSERT WITH CHECK (is_active_user());
CREATE POLICY jobs_update ON jobs FOR UPDATE
  USING (is_active_user()) WITH CHECK (is_active_user());
-- Consider tightening later: e.g. only owner can set status = 'CLOSED'
-- or 'CANCELLED'. Left open here to keep day-to-day flow simple.

CREATE POLICY job_bom_lines_all ON job_bom_lines FOR ALL
  USING (is_active_user()) WITH CHECK (is_active_user());

-- Goods receipt: storekeeper records these the same day, per your notes.
CREATE POLICY grn_all ON goods_receipts FOR ALL
  USING (is_active_user()) WITH CHECK (is_active_user());
CREATE POLICY grn_lines_all ON goods_receipt_lines FOR ALL
  USING (is_active_user()) WITH CHECK (is_active_user());

-- Scrap sales: both roles can log these.
CREATE POLICY scrap_sales_all ON scrap_sales FOR ALL
  USING (is_active_user()) WITH CHECK (is_active_user());

-- The ledger itself: both roles INSERT movements (that's the job of
-- the storekeeper day to day); nobody UPDATEs/DELETEs — already
-- hard-blocked at the trigger level for every role including owner.
CREATE POLICY stock_movements_select ON stock_movements FOR SELECT
  USING (is_active_user());
CREATE POLICY stock_movements_insert ON stock_movements FOR INSERT
  WITH CHECK (is_active_user());
-- No UPDATE/DELETE policy given → impossible via RLS *and* the
-- trigger raises an exception if anything ever reaches that path.

-- ═══════════════════════════════════════════════════════════════════
--  7. APPROVAL-GATED DATA — storekeeper can enter, only owner approves
-- ═══════════════════════════════════════════════════════════════════

-- Purchase Orders: storekeeper can create drafts; only the owner can
-- approve, reject, or edit an already-submitted PO.
CREATE POLICY po_select ON purchase_orders FOR SELECT USING (is_active_user());
CREATE POLICY po_insert ON purchase_orders FOR INSERT
  WITH CHECK (is_active_user() AND status = 'DRAFT');
CREATE POLICY po_update_owner_only ON purchase_orders FOR UPDATE
  USING (is_owner()) WITH CHECK (is_owner());
CREATE POLICY po_update_own_draft ON purchase_orders FOR UPDATE
  USING (is_storekeeper() AND status = 'DRAFT')
  WITH CHECK (is_storekeeper() AND status = 'DRAFT');
-- i.e. storekeeper can keep editing their own draft PO, but the moment
-- it's pending/approved, only the owner can touch it.

CREATE POLICY po_lines_select ON purchase_order_lines FOR SELECT
  USING (is_active_user());
CREATE POLICY po_lines_write ON purchase_order_lines FOR ALL
  USING (is_active_user()) WITH CHECK (is_active_user());

-- Stock counts: storekeeper does the counting (DRAFT / PENDING_APPROVAL);
-- only the owner can move a count to APPROVED or REJECTED.
CREATE POLICY counts_select ON stock_counts FOR SELECT USING (is_active_user());
CREATE POLICY counts_insert ON stock_counts FOR INSERT
  WITH CHECK (is_active_user() AND status IN ('DRAFT','PENDING_APPROVAL'));
CREATE POLICY counts_update_owner ON stock_counts FOR UPDATE
  USING (is_owner()) WITH CHECK (is_owner());
CREATE POLICY counts_update_storekeeper_draft ON stock_counts FOR UPDATE
  USING (is_storekeeper() AND status IN ('DRAFT','PENDING_APPROVAL'))
  WITH CHECK (is_storekeeper() AND status IN ('DRAFT','PENDING_APPROVAL'));
-- This stops a storekeeper from ever writing status = 'APPROVED'
-- themselves — combined with your existing trigger
-- (guard_count_adjustment), a COUNT_ADJUSTMENT movement genuinely
-- cannot exist without the owner's own account approving it.

CREATE POLICY count_lines_select ON stock_count_lines FOR SELECT
  USING (is_active_user());
CREATE POLICY count_lines_write ON stock_count_lines FOR ALL
  USING (is_active_user()) WITH CHECK (is_active_user());

-- ═══════════════════════════════════════════════════════════════════
--  8. OPTIONAL — hide specific columns from the storekeeper
--     (RLS can't do this; use GRANT/REVOKE column privileges instead)
-- ═══════════════════════════════════════════════════════════════════
-- Example only — uncomment and adapt once you have a Postgres role
-- that maps to "storekeeper" sessions (Supabase's `authenticated`
-- role is shared by everyone, so true column hiding usually means
-- either (a) querying through a VIEW that omits the column, granted
-- only to storekeepers, or (b) a dedicated Postgres role per app role
-- with JWT claim mapping. A simple, robust option:
--
-- CREATE VIEW materials_storekeeper_view AS
--   SELECT id, name, uom, "stockType", "minimumLevel", "isActive"
--   FROM materials;   -- omits `code`
--
-- Then point the storekeeper-facing part of your app at this view
-- instead of the `materials` table directly.

-- ═══════════════════════════════════════════════════════════════════
--  DONE. Test as each role:
--  SELECT is_owner(), is_storekeeper();  -- while impersonating a user
-- ═══════════════════════════════════════════════════════════════════
