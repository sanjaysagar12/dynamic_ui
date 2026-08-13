-- ═══════════════════════════════════════════════════════════════════
--  VIJAYA ELECTRONICS ERP — RESET QUEST
--  Drops everything this project created, in dependency-safe order,
--  so you can re-run 01 → 02 → 03 from a clean slate.
--
--  Numbered 00 on purpose: it's the file you reach for BEFORE a
--  fresh install too, in case a previous half-finished run left
--  debris behind. Safe to run on an empty database — every DROP
--  below is IF EXISTS.
--
--  This does NOT touch auth.users, storage, or anything else Supabase
--  manages outside the `public` schema.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Views ─────────────────────────────────────────────────────────
drop view if exists v_reorder_alerts     cascade;
drop view if exists v_bom_vs_actual      cascade;
drop view if exists v_job_material_cost  cascade;
drop view if exists v_material_leak      cascade;
drop view if exists v_balance_integrity  cascade;
drop view if exists materials_storekeeper cascade;

-- ── 2. Tables (CASCADE clears their triggers, policies, indexes, FKs) ─
drop table if exists attachments          cascade;
drop table if exists notifications        cascade;
drop table if exists audit_events         cascade;
drop table if exists stock_movements      cascade;
drop table if exists scrap_sales          cascade;
drop table if exists stock_count_lines    cascade;
drop table if exists stock_counts         cascade;
drop table if exists goods_receipt_lines  cascade;
drop table if exists goods_receipts       cascade;
drop table if exists purchase_order_lines cascade;
drop table if exists purchase_orders      cascade;
drop table if exists job_bom_lines        cascade;
drop table if exists jobs                 cascade;
drop table if exists customer_pos         cascade;
drop table if exists lots                 cascade;
drop table if exists stock_balances       cascade;
drop table if exists materials            cascade;
drop table if exists number_series        cascade;
drop table if exists settings             cascade;
drop table if exists parties              cascade;
drop table if exists users                cascade;

-- ── 3. Functions (guard triggers, balance engine, RLS helpers) ────────
drop function if exists apply_stock_movement()      cascade;
drop function if exists guard_count_adjustment()     cascade;
drop function if exists block_ledger_mutation()      cascade;
drop function if exists create_balance_row()         cascade;
drop function if exists set_updated_at()             cascade;
drop function if exists app_user_id()                cascade;
drop function if exists app_role()                   cascade;
drop function if exists is_owner()                   cascade;
drop function if exists is_authenticated_staff()     cascade;

-- ── 4. Enums ────────────────────────────────────────────────────────
drop type if exists po_status          cascade;
drop type if exists movement_direction cascade;
drop type if exists movement_type      cascade;
drop type if exists count_status       cascade;
drop type if exists job_status         cascade;
drop type if exists job_type           cascade;
drop type if exists customer_po_status cascade;
drop type if exists notification_type  cascade;
drop type if exists stock_type         cascade;
drop type if exists uom_type           cascade;
drop type if exists actor_type         cascade;
drop type if exists user_role          cascade;

-- pgcrypto is left installed — it's a shared extension other projects
-- in this database may depend on. Drop it manually if you're certain
-- nothing else needs gen_random_uuid():
--   drop extension if exists pgcrypto;

-- ═══════════════════════════════════════════════════════════════════
-- Clean slate. Re-run 01_create_quest.sql → 02_guard_quest.sql →
-- 03_rls_quest.sql to rebuild.
-- ═══════════════════════════════════════════════════════════════════
