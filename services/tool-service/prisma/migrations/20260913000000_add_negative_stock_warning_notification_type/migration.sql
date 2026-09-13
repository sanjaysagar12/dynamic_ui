-- issue_material.ts (Batch D) needs a Notification type for the "issuing
-- past what's on hand" warning it raises in the same transaction as the
-- ISSUE movement, alongside the existing PO_PENDING_APPROVAL-style pattern
-- create_purchase_order.ts already uses (notify every active OWNER).
ALTER TYPE "NotificationType" ADD VALUE 'NEGATIVE_STOCK_WARNING';
