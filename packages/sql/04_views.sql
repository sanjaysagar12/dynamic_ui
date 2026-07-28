-- ═══════════════════════════════════════════════════════════════════
--  VIJAYA ELECTRONICS ERP — 04 · REPORTING VIEWS
--  Balance integrity check, the material-leak report, per-job
--  material cost, BOM-vs-actual, and reorder alerts.
--  Uses security_invoker = on so each view respects the RLS policies
--  of whoever is actually querying it, instead of running as the
--  view's creator. Requires 01–03 to have run first.
-- ═══════════════════════════════════════════════════════════════════


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
