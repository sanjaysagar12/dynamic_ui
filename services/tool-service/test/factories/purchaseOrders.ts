import { randomUUID } from 'node:crypto';
import type { PoStatus, PrismaClient, PurchaseOrder, PurchaseOrderLine } from '@prisma/client';
import { createSupplier } from './parties.js';
import { createMaterial } from './materials.js';

export interface CreatePurchaseOrderLineOverride {
  materialId?: string;
  quantity?: number;
  rate?: number;
}

export interface CreatePurchaseOrderOverrides {
  number?: string;
  supplierId?: string;
  poDate?: Date;
  status?: PoStatus;
  lines?: CreatePurchaseOrderLineOverride[];
}

export type PurchaseOrderWithLines = PurchaseOrder & { lines: PurchaseOrderLine[] };

/**
 * Depends on a supplier and at least one line — if `overrides.lines` is
 * omitted (or empty), a single default line is created (a fresh material at
 * qty 10 / rate 100), so callers that don't care about line detail can just
 * call createPurchaseOrder(prisma).
 */
export async function createPurchaseOrder(
  prisma: PrismaClient,
  overrides: CreatePurchaseOrderOverrides = {},
): Promise<PurchaseOrderWithLines> {
  const suffix = randomUUID().slice(0, 8);
  const supplierId = overrides.supplierId ?? (await createSupplier(prisma)).id;

  const lineInputs = overrides.lines && overrides.lines.length > 0 ? overrides.lines : [{}];
  const lines = await Promise.all(
    lineInputs.map(async (line) => {
      const materialId = line.materialId ?? (await createMaterial(prisma)).id;
      const quantity = line.quantity ?? 10;
      const rate = line.rate ?? 100;
      return { materialId, quantity, rate, amount: quantity * rate };
    }),
  );

  const subTotal = lines.reduce((sum, line) => sum + line.amount, 0);

  return prisma.purchaseOrder.create({
    data: {
      number: overrides.number ?? `PO-TEST-${suffix}`,
      supplierId,
      poDate: overrides.poDate ?? new Date(),
      status: overrides.status ?? 'DRAFT',
      subTotal,
      gstAmount: 0,
      totalValue: subTotal,
      lines: {
        create: lines.map((line) => ({
          materialId: line.materialId,
          quantity: line.quantity,
          rate: line.rate,
          amount: line.amount,
        })),
      },
    },
    include: { lines: true },
  });
}
