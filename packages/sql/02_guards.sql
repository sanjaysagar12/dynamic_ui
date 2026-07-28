-- ═══════════════════════════════════════════════════════════════════
--  VIJAYA ELECTRONICS ERP — 02 · GUARDS (invariants + triggers)
--  Constraints and triggers that enforce the business rules:
--   - quantities/rates never negative, GRN split adds up, etc.
--   - stock_movements is append-only (no UPDATE/DELETE, ever)
--   - stock_balances is auto-maintained from the ledger
--   - COUNT_ADJUSTMENT can only come from an owner-approved count
--  Requires 01_create_tables.sql to have been run first.
--  Run 03_rls.sql next.
-- ═══════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════

-- ── Quantities and rates are never negative ───────────────────────
ALTER TABLE stock_movements
  ADD CONSTRAINT chk_movement_qty_positive  CHECK (quantity > 0),
  ADD CONSTRAINT chk_movement_rate_positive CHECK (rate >= 0);

ALTER TABLE stock_balances
  ADD CONSTRAINT chk_balance_rate_positive CHECK ("averageRate" >= 0);

-- ── Inspection split must add up ──────────────────────────────────
ALTER TABLE goods_receipt_lines
  ADD CONSTRAINT chk_grn_split
    CHECK ("acceptedQty" + "rejectedQty" = "receivedQty"),
  ADD CONSTRAINT chk_grn_qty_positive
    CHECK ("receivedQty" > 0 AND "acceptedQty" >= 0 AND "rejectedQty" >= 0);

-- ── BOM quantities are positive ───────────────────────────────────
ALTER TABLE job_bom_lines
  ADD CONSTRAINT chk_bom_qty_positive
    CHECK ("qtyPerPiece" > 0 AND "requiredQty" > 0);

ALTER TABLE jobs
  ADD CONSTRAINT chk_job_qty_positive CHECK (quantity > 0);

-- ── Count difference must equal counted − system ──────────────────
ALTER TABLE stock_count_lines
  ADD CONSTRAINT chk_count_difference
    CHECK ("differenceQty" = "countedQty" - "systemQty");

-- ── Direction must match movement type ────────────────────────────
ALTER TABLE stock_movements
  ADD CONSTRAINT chk_movement_direction CHECK (
    (type IN ('OPENING','RECEIPT','RETURN','SCRAP_IN') AND direction = 'IN')
    OR (type IN ('ISSUE','REJECT_RETURN','SCRAP_SALE') AND direction = 'OUT')
    OR (type IN ('COUNT_ADJUSTMENT','REVERSAL'))
  );

-- ── Every ISSUE and RETURN must name a job ────────────────────────
ALTER TABLE stock_movements
  ADD CONSTRAINT chk_issue_has_job CHECK (
    type NOT IN ('ISSUE','RETURN') OR "jobId" IS NOT NULL
  );

-- ── COUNT_ADJUSTMENT can ONLY come from an approved count ─────────
ALTER TABLE stock_movements
  ADD CONSTRAINT chk_adjustment_has_count CHECK (
    type <> 'COUNT_ADJUSTMENT' OR "stockCountLineId" IS NOT NULL
  );

CREATE OR REPLACE FUNCTION guard_count_adjustment()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_guard_count_adjustment
  BEFORE INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION guard_count_adjustment();

-- ── THE LEDGER IS APPEND-ONLY ──────────────────────────────────────
CREATE OR REPLACE FUNCTION block_ledger_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'stock_movements is append-only. Post a REVERSAL movement instead of %.',
    TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_block_movement_update
  BEFORE UPDATE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION block_ledger_mutation();

CREATE TRIGGER trg_block_movement_delete
  BEFORE DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION block_ledger_mutation();

CREATE TRIGGER trg_block_audit_update
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION block_ledger_mutation();

-- ── BALANCE MAINTENANCE — weighted average, in-transaction ────────
CREATE OR REPLACE FUNCTION apply_stock_movement()
RETURNS TRIGGER AS $$
DECLARE
  v_qty      NUMERIC(18,4);
  v_rate     NUMERIC(18,4);
  v_value    NUMERIC(18,2);
  v_new_qty  NUMERIC(18,4);
  v_new_rate NUMERIC(18,4);
  v_new_val  NUMERIC(18,2);
BEGIN
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
    v_new_rate := v_rate;
  END IF;

  v_new_val := ROUND(v_new_qty * v_new_rate, 2);

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

  NEW."balanceQtyAfter"   := v_new_qty;
  NEW."balanceRateAfter"  := v_new_rate;
  NEW."balanceValueAfter" := v_new_val;
  NEW.value               := ROUND(NEW.quantity * NEW.rate, 2);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_apply_stock_movement
  BEFORE INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION apply_stock_movement();

-- ── Every material gets a balance row automatically ───────────────
CREATE OR REPLACE FUNCTION create_balance_row()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO stock_balances ("materialId", quantity, "averageRate", "stockValue", "updatedAt")
  VALUES (NEW.id, 0, 0, 0, NOW())
  ON CONFLICT ("materialId") DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_create_balance_row
  AFTER INSERT ON materials
  FOR EACH ROW EXECUTE FUNCTION create_balance_row();

