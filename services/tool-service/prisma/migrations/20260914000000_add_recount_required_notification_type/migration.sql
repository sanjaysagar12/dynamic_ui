-- reject_stock_count.ts (Batch F) needs a Notification type for the
-- "count rejected — recount needed" notification it raises in the same
-- transaction as the REJECTED status flip. Same pattern as the existing
-- NEGATIVE_STOCK_WARNING migration.
ALTER TYPE "NotificationType" ADD VALUE 'RECOUNT_REQUIRED';
