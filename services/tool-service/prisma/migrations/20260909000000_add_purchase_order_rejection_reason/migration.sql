-- reject_purchase_order.ts (src/tools/plugins/reject_purchase_order.ts) writes
-- PurchaseOrder.rejectionReason, and schema.prisma declares the column, but no
-- migration ever added it to purchase_orders — a pre-existing migration/schema
-- drift this migration closes.
ALTER TABLE "purchase_orders" ADD COLUMN "rejectionReason" TEXT;
