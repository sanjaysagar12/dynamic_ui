-- Suppliers & customers become a proper master (create_party / update_party /
-- deactivate_party / search_parties), and purchase orders stop creating them.
--
-- nameKey is nullable so this can be added to a table that already has rows.
-- After deploying, fill it for existing parties:
--   npx tsx prisma/backfill-party-namekey.ts          (report only)
--   npx tsx prisma/backfill-party-namekey.ts --apply  (write)

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PO_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'PO_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'RATE_CHANGE';
ALTER TYPE "NotificationType" ADD VALUE 'JOB_VARIANCE';
ALTER TYPE "NotificationType" ADD VALUE 'COUNT_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'MOVEMENT_REVERSED';

-- AlterTable
ALTER TABLE "parties" ADD COLUMN "nameKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "parties_nameKey_key" ON "parties"("nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "parties_gstin_key" ON "parties"("gstin");

-- CreateIndex
CREATE INDEX "parties_name_idx" ON "parties"("name");
