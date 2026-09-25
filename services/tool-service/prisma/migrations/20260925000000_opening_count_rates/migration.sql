-- Opening count: rate per material (required by trg_guard_count_submission on
-- opening counts) and the invoice it came from (optional).
-- The guards themselves live in inventory_guards.sql. On an existing database,
-- apply prisma/opening_count_live.sql after this migration.

-- AlterTable
ALTER TABLE "stock_count_lines" ADD COLUMN     "sourceInvoiceDate" DATE,
ADD COLUMN     "sourceInvoiceNo" TEXT,
ADD COLUMN     "unitRate" DECIMAL(18,4);
