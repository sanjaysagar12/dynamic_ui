import { randomUUID } from 'node:crypto';
import type { CountStatus, PrismaClient, StockCount, StockCountLine } from '@prisma/client';
import { createMaterial } from './materials.js';

export interface CreateStockCountLineOverride {
  materialId?: string;
  systemQty?: number;
  countedQty?: number;
  reasonCode?: string | null;
}

export interface CreateStockCountOverrides {
  number?: string;
  countDate?: Date;
  status?: CountStatus;
  isOpening?: boolean;
  approvedById?: string | null;
  lines?: CreateStockCountLineOverride[];
}

export type StockCountWithLines = StockCount & { lines: StockCountLine[] };

/**
 * `status` defaults to DRAFT but can be set to PENDING_APPROVAL or APPROVED
 * directly, for guard tests that need to start from an already-approved (or
 * already-pending) count rather than walking through the approval flow
 * themselves. `differenceQty` is always derived as countedQty - systemQty,
 * matching the chk_count_difference DB constraint — a factory that let a
 * caller set an inconsistent difference would just fail at insert time.
 */
export async function createStockCount(
  prisma: PrismaClient,
  overrides: CreateStockCountOverrides = {},
): Promise<StockCountWithLines> {
  const suffix = randomUUID().slice(0, 8);
  const status = overrides.status ?? 'DRAFT';

  const lineInputs = overrides.lines && overrides.lines.length > 0 ? overrides.lines : [{}];
  const lines = await Promise.all(
    lineInputs.map(async (line) => {
      const materialId = line.materialId ?? (await createMaterial(prisma)).id;
      const systemQty = line.systemQty ?? 0;
      const countedQty = line.countedQty ?? systemQty;
      return {
        materialId,
        systemQty,
        countedQty,
        differenceQty: countedQty - systemQty,
        reasonCode: line.reasonCode ?? undefined,
      };
    }),
  );

  return prisma.stockCount.create({
    data: {
      number: overrides.number ?? `CNT-TEST-${suffix}`,
      countDate: overrides.countDate ?? new Date(),
      status,
      isOpening: overrides.isOpening ?? false,
      approvedById: overrides.approvedById ?? undefined,
      approvedAt: status === 'APPROVED' ? new Date() : undefined,
      lines: {
        create: lines,
      },
    },
    include: { lines: true },
  });
}
