-- ═══════════════════════════════════════════════════════════════════
--  VIJAYA ELECTRONICS ERP — VIEW SECURITY FIX
--  Run this against an existing database (safe, idempotent, no data
--  changes). Also folded into 02_guard_quest.sql below for anyone
--  running the full setup fresh.
--
--  WHY: Postgres views default to running with the privileges of the
--  view's OWNER, not the querying user — effectively SECURITY DEFINER
--  behaviour. Since every underlying table here has RLS enabled, a
--  view without security_invoker can end up evaluating RLS as the
--  owner role (e.g. postgres, which often bypasses RLS or has broader
--  grants) instead of as the actual logged-in `authenticated` user.
--  security_invoker = on forces the view to run under the querying
--  user's own permissions, so it respects that user's RLS policies on
--  materials / stock_balances / stock_movements / stock_count_lines /
--  stock_counts / jobs / parties / job_bom_lines exactly as if they'd
--  queried those tables directly.
--
--  Confirmed safe for all five views below: every underlying table's
--  SELECT policy is `is_authenticated_staff()`, so any staff member
--  who could already see the base rows sees the same aggregated rows
--  through the view — nothing new is hidden or exposed.
-- ═══════════════════════════════════════════════════════════════════

ALTER VIEW public.v_balance_integrity  SET (security_invoker = on);
ALTER VIEW public.v_material_leak      SET (security_invoker = on);
ALTER VIEW public.v_job_material_cost  SET (security_invoker = on);
ALTER VIEW public.v_bom_vs_actual      SET (security_invoker = on);
ALTER VIEW public.v_reorder_alerts     SET (security_invoker = on);