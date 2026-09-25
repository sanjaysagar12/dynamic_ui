-- ═══════════════════════════════════════════════════════════════════
--  OPENING COUNT — apply to an EXISTING database, once.
--
--  inventory_guards.sql now contains all of this, and a fresh database
--  gets it from there. But inventory_guards.sql can't be re-run on a
--  database that already has the guards (its CREATE TRIGGER / ADD
--  CONSTRAINT statements would fail), so this file applies only the
--  changes, safely re-runnable.
--
--  Order: `npx prisma migrate deploy` first (adds the columns), then:
--    psql "$DIRECT_URL" -f prisma/opening_count_live.sql
--  or paste into the Supabase SQL editor.
--
--  If step 1 fails: the database already has OPENING movements that didn't
--  come from a count (test data). Reset the test database instead.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- 1. OPENING movements only from a count line
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS chk_opening_has_count;
ALTER TABLE stock_movements
  ADD CONSTRAINT chk_opening_has_count CHECK (
    type <> 'OPENING' OR "stockCountLineId" IS NOT NULL
  );

-- 2. Opening rates are never ₹0 or negative
ALTER TABLE stock_count_lines DROP CONSTRAINT IF EXISTS chk_count_rate_positive;
ALTER TABLE stock_count_lines
  ADD CONSTRAINT chk_count_rate_positive
    CHECK ("unitRate" IS NULL OR "unitRate" > 0);

-- 3. Adjustment guard now also covers OPENING (same trigger, new body)
CREATE OR REPLACE FUNCTION guard_count_adjustment()
RETURNS TRIGGER AS $$
DECLARE
  v_status     TEXT;
  v_is_opening BOOLEAN;
BEGIN
  IF NEW.type IN ('COUNT_ADJUSTMENT', 'OPENING') THEN
    SELECT sc.status, sc."isOpening" INTO v_status, v_is_opening
    FROM stock_count_lines scl
    JOIN stock_counts sc ON sc.id = scl."stockCountId"
    WHERE scl.id = NEW."stockCountLineId";

    IF v_status IS DISTINCT FROM 'APPROVED' THEN
      RAISE EXCEPTION
        'Stock adjustment blocked: count is % , owner approval required',
        COALESCE(v_status, 'MISSING');
    END IF;
    IF NEW.type = 'OPENING' AND v_is_opening IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'OPENING movements can only come from the opening count';
    END IF;
    IF NEW.type = 'COUNT_ADJUSTMENT' AND v_is_opening THEN
      RAISE EXCEPTION 'The opening count posts OPENING movements, not COUNT_ADJUSTMENT';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_count_adjustment ON stock_movements;
CREATE TRIGGER trg_guard_count_adjustment
  BEFORE INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION guard_count_adjustment();

-- 4. Submission guard: nothing blank; rate on every opening line; one opening ever
CREATE OR REPLACE FUNCTION guard_count_submission()
RETURNS TRIGGER AS $$
DECLARE
  v_missing_qty  INT;
  v_missing_rate INT;
  v_other        INT;
BEGIN
  IF NEW.status IN ('PENDING_APPROVAL', 'APPROVED')
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT COUNT(*) INTO v_missing_qty
    FROM stock_count_lines
    WHERE "stockCountId" = NEW.id AND "countedQty" IS NULL;
    IF v_missing_qty > 0 THEN
      RAISE EXCEPTION 'COUNT_INCOMPLETE: % material(s) not yet counted', v_missing_qty;
    END IF;

    IF NEW."isOpening" THEN
      SELECT COUNT(*) INTO v_missing_rate
      FROM stock_count_lines
      WHERE "stockCountId" = NEW.id AND "countedQty" > 0 AND "unitRate" IS NULL;
      IF v_missing_rate > 0 THEN
        RAISE EXCEPTION 'COUNT_INCOMPLETE: % material(s) without a rate', v_missing_rate;
      END IF;
    END IF;
  END IF;

  IF NEW."isOpening" AND NEW.status = 'APPROVED'
     AND OLD.status IS DISTINCT FROM 'APPROVED' THEN
    PERFORM pg_advisory_xact_lock(hashtext('vijaya_opening_count'));
    SELECT COUNT(*) INTO v_other
    FROM stock_counts
    WHERE "isOpening" AND status = 'APPROVED' AND id <> NEW.id;
    IF v_other > 0 THEN
      RAISE EXCEPTION 'OPENING_ALREADY_DONE: an opening count has already been approved';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_count_submission ON stock_counts;
CREATE TRIGGER trg_guard_count_submission
  BEFORE UPDATE ON stock_counts
  FOR EACH ROW EXECUTE FUNCTION guard_count_submission();

-- 5. Leak report: exclude the opening count; only real differences are "unexplained"
CREATE OR REPLACE VIEW v_material_leak AS
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
  COUNT(*) FILTER (WHERE scl."differenceQty" <> 0
                     AND (scl."reasonCode" IS NULL
                          OR scl."reasonCode" = 'UNEXPLAINED'))
                                                   AS unexplained_count,
  MAX(sc."countDate")                              AS last_counted
FROM stock_count_lines scl
JOIN stock_counts sc ON sc.id = scl."stockCountId"
                    AND sc.status = 'APPROVED'
                    AND sc."isOpening" = false
JOIN materials m     ON m.id = scl."materialId"
JOIN stock_balances b ON b."materialId" = m.id
GROUP BY m.id, m.name, m.uom
ORDER BY total_variance_value DESC NULLS LAST;

COMMIT;
