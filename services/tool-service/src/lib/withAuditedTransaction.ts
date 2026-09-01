import { Prisma, type PrismaClient } from '@prisma/client';
import type { ToolContext } from '../tools/types.js';

export interface AuditMeta {
  entityType: string;
  entityId: string;
  action: string;
  toolName: string;
  agentRunId?: string;
  reason?: string;
  beforeJson?: unknown;
  afterJson?: unknown;
}

/**
 * Wraps a write in a transaction and inserts exactly one AuditEvent row
 * inside that same transaction. buildMeta runs after fn so entityId (and
 * anything else only known post-write, e.g. a newly created row's id) can
 * be derived from fn's own return value. If fn or the audit insert throws,
 * the whole transaction rolls back — an unaudited write is exactly the
 * failure mode this exists to prevent.
 */
export async function withAuditedTransaction<T>(
  ctx: ToolContext,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  buildMeta: (result: T) => AuditMeta,
): Promise<T> {
  return (ctx.prisma as PrismaClient).$transaction(async (tx) => {
    const result = await fn(tx);
    const meta = buildMeta(result);

    await tx.auditEvent.create({
      data: {
        entityType: meta.entityType,
        entityId: meta.entityId,
        action: meta.action,
        toolName: meta.toolName,
        agentRunId: meta.agentRunId,
        reason: meta.reason,
        beforeJson: meta.beforeJson as Prisma.InputJsonValue | undefined,
        afterJson: meta.afterJson as Prisma.InputJsonValue | undefined,
        actorType: ctx.userId ? 'HUMAN' : 'AGENT',
        actorId: ctx.userId,
      },
    });

    return result;
  });
}
