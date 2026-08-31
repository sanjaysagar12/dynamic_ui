-- ═══════════════════════════════════════════════════════════════════
--  VIJAYA ELECTRONICS ERP — INVENTORY INVARIANTS  (GUARD QUEST)
--  Run this SECOND, right after 01_create_quest.sql. These are NOT
--  optional — every constraint and trigger below is what makes the
--  ledger trustworthy even when an agent is the one writing to it.
--
--  Why database-level and not just in the tool layer:
--  agents write to these tables. An agent will eventually be wrong,
--  or be talked into being wrong. The tool layer is the first line of
--  defence; this is the one that cannot be argued with.
--
--  FIX LOG (this revision):
--   - apply_stock_movement() and create_balance_row() now run as
--     SECURITY DEFINER. Without it, these BEFORE-INSERT triggers ran
--     as the calling `authenticated` role, and stock_balances has no
--     INSERT/UPDATE policy for that role in 03_rls_quest.sql — so
--     create_material silently failed on INSERT, and every stock
--     movement's balance UPDATE was silently filtered to 0 rows by
--     RLS while the trigger still stamped balanceQtyAfter/etc. onto
--     the ledger row as if it had succeeded. Ledger and balance table
--     diverged from the very first write. Added ROW_COUNT checks so
--     any future regression here throws instead of drifting silently.
--   - Added guard_bom_lock(): job_bom_lines' qtyPerPiece/requiredQty
--     can only be set while the job is OPEN (matches set_job_bom's
--     JOB_NOT_OPEN rule). issuedQty/returnedQty updates from
--     issue_material/return_material are still allowed at any status.
--   - All five views (v_balance_integrity, v_material_leak,
--     v_job_material_cost, v_bom_vs_actual, v_reorder_alerts) now
--     declare WITH (security_invoker = on), per Supabase's linter.
--     Without it, views default to running with the view OWNER's
--     privileges rather than the querying user's, which can bypass
--     that user's RLS context. Confirmed safe here: every underlying
--     table's SELECT policy is is_authenticated_staff(), so no staff
--     member loses or gains visibility by this change.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Quantities and rates are never negative ────────────────────
ALTER TABLE stock_movements
  ADD CONSTRAINT chk_movement_qty_positive  CHECK (quantity > 0),
  ADD CONSTRAINT chk_movement_rate_positive CHECK (rate >= 0);

ALTER TABLE stock_balances
  ADD CONSTRAINT chk_balance_rate_positive CHECK ("averageRate" >= 0);

-- ── 2. Inspection split must add up ───────────────────────────────
ALTER TABLE goods_receipt_lines
  ADD CONSTRAINT chk_grn_split
    CHECK ("acceptedQty" + "rejectedQty" = "receivedQty"),
  ADD CONSTRAINT chk_grn_qty_positive
    CHECK ("receivedQty" > 0 AND "acceptedQty" >= 0 AND "rejectedQty" >= 0);

-- ── 3. BOM quantities are positive ────────────────────────────────
ALTER TABLE job_bom_lines
  ADD CONSTRAINT chk_bom_qty_positive
    CHECK ("qtyPerPiece" > 0 AND "requiredQty" > 0);

ALTER TABLE jobs
  ADD CONSTRAINT chk_job_qty_positive CHECK (quantity > 0);

-- ── 4. Count difference must equal counted − system ───────────────
--     Stops a "corrected" difference from being slipped in.
ALTER TABLE stock_count_lines
  ADD CONSTRAINT chk_count_difference
    CHECK ("differenceQty" = "countedQty" - "systemQty");

-- ── 5. Direction must match movement type ─────────────────────────
ALTER TABLE stock_movements
  ADD CONSTRAINT chk_movement_direction CHECK (
    (type IN ('OPENING','RECEIPT','RETURN','SCRAP_IN') AND direction = 'IN')
    OR (type IN ('ISSUE','REJECT_RETURN','SCRAP_SALE') AND direction = 'OUT')
    OR (type IN ('COUNT_ADJUSTMENT','REVERSAL'))  -- either direction
  );

-- ── 6. Every ISSUE and RETURN must name a job ─────────────────────
--     This is what makes per-job material cost automatic.
ALTER TABLE stock_movements
  ADD CONSTRAINT chk_issue_has_job CHECK (
    type NOT IN ('ISSUE','RETURN') OR "jobId" IS NOT NULL
  );

-- ── 7. COUNT_ADJUSTMENT can ONLY come from an approved count ──────
--     The heart of "stop overwriting". Stock cannot be silently
--     corrected by anything except an owner-approved count line.
ALTER TABLE stock_movements
  ADD CONSTRAINT chk_adjustment_has_count CHECK (
    type <> 'COUNT_ADJUSTMENT' OR "stockCountLineId" IS NOT NULL
  );

CREATE OR REPLACE FUNCTION guard_count_adjustment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF NEW.type = 'COUNT_ADJUSTMENT' THEN
    SELECT sc.status INTO v_status
    FROM stock_count_lines scl
    JOIN stock_counts sc ON sc.id = scl."stockCountId"
    WHERE scl.id = NEW."stockCountLineId";

    IF v_status IS DISTINCT FROM 'APPROVED' THEN
      RAISE EXCEPTION
        'Stock adjustment blocked: count is % , owner approval required',
        COALESCE(v_status, 'MISSING');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
-- SECURITY DEFINER here too: this only ever reads (stock_count_lines /
-- stock_counts, both of which authenticated can already SELECT), so it
-- isn't required for correctness the way it is below — but matching it
-- avoids a second inconsistent trigger-permission model in this file.

CREATE TRIGGER trg_guard_count_adjustment
  BEFORE INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION guard_count_adjustment();

-- ── 7b. BOM lock — qtyPerPiece/requiredQty frozen once job leaves OPEN
--     set_job_bom's own precondition is "Job status must be OPEN...
--     If the job has already moved past OPEN, refuse and direct the
--     caller to add_bom_line for a rework top-up instead." That's a
--     tool-layer rule; this is the DB-level backstop for it. It does
--     NOT block issuedQty/returnedQty changes — those come from
--     issue_material/return_material and are valid at MATERIAL_ISSUED.
CREATE OR REPLACE FUNCTION guard_bom_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status job_status;
BEGIN
  SELECT status INTO v_status FROM jobs WHERE id = NEW."jobId";

  IF TG_OP = 'INSERT' THEN
    IF v_status IS DISTINCT FROM 'OPEN' THEN
      RAISE EXCEPTION
        'Cannot add a BOM line: job status is %, must be OPEN', v_status;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF (NEW."qtyPerPiece" IS DISTINCT FROM OLD."qtyPerPiece"
        OR NEW."requiredQty" IS DISTINCT FROM OLD."requiredQty")
       AND v_status IS DISTINCT FROM 'OPEN' THEN
      RAISE EXCEPTION
        'Cannot change BOM quantities: job status is %, must be OPEN', v_status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_bom_lock
  BEFORE INSERT OR UPDATE ON job_bom_lines
  FOR EACH ROW EXECUTE FUNCTION guard_bom_lock();

-- ── 8. THE LEDGER IS APPEND-ONLY ──────────────────────────────────
--     No UPDATE. No DELETE. Ever. Corrections are REVERSAL rows.
--     This single guard is what makes the audit trail worth trusting.
CREATE OR REPLACE FUNCTION block_ledger_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'stock_movements is append-only. Post a REVERSAL movement instead of %.',
    TG_OP;
END;
$$;

CREATE TRIGGER trg_block_movement_update
  BEFORE UPDATE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION block_ledger_mutation();

CREATE TRIGGER trg_block_movement_delete
  BEFORE DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION block_ledger_mutation();

-- Audit events are equally immutable.
CREATE TRIGGER trg_block_audit_update
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION block_ledger_mutation();

-- ── 9. BALANCE MAINTENANCE — weighted average, in-transaction ─────
--     Balance is DERIVED. The application never writes it directly;
--     inserting a movement is the only way it changes.
--
--     Weighted average rule (confirmed with owner):
--       IN  → new_avg = (old_value + incoming_value) / (old_qty + in_qty)
--       OUT → average UNCHANGED, value reduced at the current average
--
--     Returns from the floor come back IN at the current average, so
--     they do not distort the rate.
--
--     SECURITY DEFINER is load-bearing here: `authenticated` callers
--     have no UPDATE policy on stock_balances (by design — see
--     03_rls_quest.sql §5), so without SECURITY DEFINER this trigger's
--     UPDATE would be silently filtered to 0 rows by RLS while still
--     reporting success. The ROW_COUNT check below turns that failure
--     mode into a loud exception instead of silent ledger/balance drift.
CREATE OR REPLACE FUNCTION apply_stock_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_qty      NUMERIC(18,4);
  v_rate     NUMERIC(18,4);
  v_value    NUMERIC(18,2);
  v_new_qty  NUMERIC(18,4);
  v_new_rate NUMERIC(18,4);
  v_new_val  NUMERIC(18,2);
  v_rows     INTEGER;
BEGIN
  -- Lock this material's balance row for the transaction
  SELECT quantity, "averageRate", "stockValue"
    INTO v_qty, v_rate, v_value
  FROM stock_balances
  WHERE "materialId" = NEW."materialId"
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No stock_balances row for material %', NEW."materialId";
  END IF;

  IF NEW.direction = 'IN' THEN
    v_new_qty := v_qty + NEW.quantity;
    IF v_new_qty > 0 THEN
      -- RETURN comes back at the existing average, not a new rate
      IF NEW.type = 'RETURN' THEN
        v_new_rate := v_rate;
      ELSE
        v_new_rate := ROUND(
          (v_value + (NEW.quantity * NEW.rate)) / v_new_qty, 4);
      END IF;
    ELSE
      v_new_rate := v_rate;
    END IF;
  ELSE
    v_new_qty  := v_qty - NEW.quantity;
    v_new_rate := v_rate;  -- outward never moves the average
  END IF;

  v_new_val := ROUND(v_new_qty * v_new_rate, 2);

  -- Negative stock is ALLOWED but flagged: shop-floor paperwork lags
  -- reality, and blocking it teaches the storekeeper to lie. The agent
  -- turns the notice below into a task for the owner.
  IF v_new_qty < 0 THEN
    RAISE NOTICE 'NEGATIVE STOCK on material % → %', NEW."materialId", v_new_qty;
  END IF;

  UPDATE stock_balances
     SET quantity         = v_new_qty,
         "averageRate"    = v_new_rate,
         "stockValue"     = v_new_val,
         "lastMovementAt" = NEW."movementDate",
         "updatedAt"      = NOW()
   WHERE "materialId" = NEW."materialId";

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION
      'apply_stock_movement: balance UPDATE affected 0 rows for material % — check RLS/grants on stock_balances',
      NEW."materialId";
  END IF;

  -- Stamp the running balance onto the ledger row itself
  NEW."balanceQtyAfter"   := v_new_qty;
  NEW."balanceRateAfter"  := v_new_rate;
  NEW."balanceValueAfter" := v_new_val;
  NEW.value               := ROUND(NEW.quantity * NEW.rate, 2);

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_apply_stock_movement
  BEFORE INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION apply_stock_movement();

-- ── 10. Every material gets a balance row automatically ───────────
--      SECURITY DEFINER for the same reason as above: authenticated
--      has no INSERT policy on stock_balances, so create_material
--      would otherwise fail RLS on this INSERT the instant a real
--      (non-service_role) user creates a material.
CREATE OR REPLACE FUNCTION create_balance_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO stock_balances ("materialId", quantity, "averageRate", "stockValue", "updatedAt")
  VALUES (NEW.id, 0, 0, 0, NOW())
  ON CONFLICT ("materialId") DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_create_balance_row
  AFTER INSERT ON materials
  FOR EACH ROW EXECUTE FUNCTION create_balance_row();

-- ── 11. Reconciliation view — the ledger must always equal the balance
--        Run nightly. Any row returned means something is very wrong.
CREATE OR REPLACE VIEW v_balance_integrity
WITH (security_invoker = on) AS
SELECT
  m.id                        AS material_id,
  m.name                      AS material_name,
  b.quantity                  AS balance_qty,
  COALESCE(SUM(
    CASE WHEN mv.direction = 'IN' THEN mv.quantity ELSE -mv.quantity END
  ), 0)                       AS ledger_qty,
  b.quantity - COALESCE(SUM(
    CASE WHEN mv.direction = 'IN' THEN mv.quantity ELSE -mv.quantity END
  ), 0)                       AS drift
FROM materials m
JOIN stock_balances b ON b."materialId" = m.id
LEFT JOIN stock_movements mv ON mv."materialId" = m.id
GROUP BY m.id, m.name, b.quantity
HAVING ABS(b.quantity - COALESCE(SUM(
  CASE WHEN mv.direction = 'IN' THEN mv.quantity ELSE -mv.quantity END
), 0)) > 0.0001;

-- ── 12. THE LEAK REPORT — what the owner actually bought this for ──
--        Every count difference, per material, never overwritten,
--        accumulating until the pattern is undeniable.
CREATE OR REPLACE VIEW v_material_leak
WITH (security_invoker = on) AS
SELECT
  m.id   AS material_id,
  m.name AS material_name,
  m.uom,
  COUNT(scl.id)                                   AS times_counted,
  COUNT(*) FILTER (WHERE scl."differenceQty" <> 0) AS times_mismatched,
  SUM(scl."differenceQty")                        AS net_difference_qty,
  SUM(CASE WHEN scl."differenceQty" < 0
           THEN ABS(scl."differenceQty") ELSE 0 END) AS total_shortage_qty,
  SUM(ABS(scl."differenceQty") * b."averageRate")    AS total_variance_value,
  COUNT(*) FILTER (WHERE scl."reasonCode" IS NULL
                      OR scl."reasonCode" = 'UNEXPLAINED')
                                                   AS unexplained_count,
  MAX(sc."countDate")                              AS last_counted
FROM stock_count_lines scl
JOIN stock_counts sc ON sc.id = scl."stockCountId" AND sc.status = 'APPROVED'
JOIN materials m     ON m.id = scl."materialId"
JOIN stock_balances b ON b."materialId" = m.id
GROUP BY m.id, m.name, m.uom
ORDER BY total_variance_value DESC NULLS LAST;

-- ── 13. Per-job material cost — falls out free from the ledger ────
CREATE OR REPLACE VIEW v_job_material_cost
WITH (security_invoker = on) AS
SELECT
  j.id     AS job_id,
  j.number AS job_number,
  p.name   AS customer_name,
  j."productDescription",
  j.quantity,
  SUM(CASE WHEN mv.type = 'ISSUE'  THEN mv.value ELSE 0 END) AS issued_value,
  SUM(CASE WHEN mv.type = 'RETURN' THEN mv.value ELSE 0 END) AS returned_value,
  SUM(CASE WHEN mv.type = 'ISSUE'  THEN mv.value
           WHEN mv.type = 'RETURN' THEN -mv.value ELSE 0 END) AS net_material_cost,
  CASE WHEN j.quantity > 0 THEN ROUND(
    SUM(CASE WHEN mv.type = 'ISSUE'  THEN mv.value
             WHEN mv.type = 'RETURN' THEN -mv.value ELSE 0 END) / j.quantity, 2)
  END AS material_cost_per_piece
FROM jobs j
JOIN parties p ON p.id = j."customerId"
LEFT JOIN stock_movements mv ON mv."jobId" = j.id
GROUP BY j.id, j.number, p.name, j."productDescription", j.quantity;

-- ── 14. BOM vs actual — where copper really goes ──────────────────
CREATE OR REPLACE VIEW v_bom_vs_actual
WITH (security_invoker = on) AS
SELECT
  j.number                    AS job_number,
  m.name                      AS material_name,
  m.uom,
  bl."requiredQty"            AS bom_required,
  bl."issuedQty"              AS actually_issued,
  bl."returnedQty"            AS returned,
  bl."issuedQty" - bl."returnedQty"                 AS net_consumed,
  (bl."issuedQty" - bl."returnedQty") - bl."requiredQty" AS variance,
  CASE WHEN bl."requiredQty" > 0 THEN ROUND(
    (((bl."issuedQty" - bl."returnedQty") - bl."requiredQty")
      / bl."requiredQty") * 100, 2)
  END AS variance_pct
FROM job_bom_lines bl
JOIN jobs j     ON j.id = bl."jobId"
JOIN materials m ON m.id = bl."materialId";

-- ── 15. Reorder alerts — standing stock only (purchasing is reactive)
CREATE OR REPLACE VIEW v_reorder_alerts
WITH (security_invoker = on) AS
SELECT
  m.id, m.name, m.uom,
  b.quantity      AS on_hand,
  m."minimumLevel",
  m."minimumLevel" - b.quantity AS shortfall
FROM materials m
JOIN stock_balances b ON b."materialId" = m.id
WHERE m."stockType" = 'STANDING'
  AND m."isActive"
  AND m."minimumLevel" IS NOT NULL
  AND b.quantity < m."minimumLevel";