-- start_stock_count.ts (Batch F) creates one StockCountLine per material
-- with only systemQty known — countedQty/differenceQty are filled in later
-- by submit_count_line.ts. submit_stock_count.ts's INCOMPLETE_COUNT check
-- depends on countedQty genuinely being unset (NULL) until then, not just
-- an app-level zero placeholder.
--
-- chk_count_difference (inventory_guards.sql: CHECK ("differenceQty" =
-- "countedQty" - "systemQty")) needs no change: under SQL's three-valued
-- logic, a NULL countedQty makes the expression evaluate to NULL, and a
-- CHECK constraint only rejects a row when its expression is FALSE —
-- NULL (unknown) is treated as satisfying the constraint.
ALTER TABLE "stock_count_lines" ALTER COLUMN "countedQty" DROP NOT NULL;
ALTER TABLE "stock_count_lines" ALTER COLUMN "differenceQty" DROP NOT NULL;
