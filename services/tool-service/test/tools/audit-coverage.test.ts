import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { startTestDatabase, type TestDatabase } from '../infra/testDatabase.js';
import { getTestPrismaClient } from '../infra/prismaClient.js';
import { createTestUser } from '../infra/testUser.js';
import { createMaterial } from '../factories/materials.js';
import { createCustomer, createSupplier } from '../factories/parties.js';
import { createJob } from '../factories/jobs.js';
import { createPurchaseOrder } from '../factories/purchaseOrders.js';
import { createStockCount } from '../factories/stockCounts.js';
import { createTestMovement } from '../infra/testMovement.js';
import type { ToolContext } from '../../src/tools/types.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import updateMaterialTool from '../../src/tools/plugins/update_material.js';

// Per-tool minimal-valid-args builders, keyed by tool name — must grow
// alongside MUTATING_AUTHED_TOOL_NAMES below (the "loudly fails if a tool
// has no entry" test enforces that the two can't silently drift apart).
type ArgsBuilder = (prisma: PrismaClient) => Promise<Record<string, unknown>>;

const ARGS_BUILDERS: Record<string, ArgsBuilder> = {
  create_user: async () => ({
    email: `audit-coverage-create-user-${randomUUID()}@example.test`,
    password: 'audit-coverage-password',
    role: 'STOREKEEPER',
  }),
  create_material: async () => ({
    name: `Audit Coverage Material ${randomUUID()}`,
    uom: 'KG',
    stockType: 'PER_JOB',
  }),
  update_material: async (prisma) => {
    const material = await createMaterial(prisma);
    return { materialId: material.id, name: `Audit Coverage Updated ${randomUUID()}` };
  },
  deactivate_material: async (prisma) => {
    const material = await createMaterial(prisma);
    return { materialId: material.id, reason: 'audit-coverage test' };
  },
  create_customer_po: async () => ({
    customerName: `Audit Coverage Customer ${randomUUID()}`,
    number: `PO-AUDIT-${randomUUID()}`,
  }),
  create_job: async (prisma) => {
    const customer = await createCustomer(prisma);
    return {
      customerId: customer.id,
      productDescription: 'Audit coverage test product',
      quantity: 10,
      jobDate: new Date(),
    };
  },
  set_job_bom: async (prisma) => {
    const job = await createJob(prisma);
    const material = await createMaterial(prisma);
    return { jobId: job.id, lines: [{ materialId: material.id, qtyPerPiece: 1 }] };
  },
  create_purchase_order: async (prisma) => {
    const material = await createMaterial(prisma);
    return {
      supplierName: `Audit Coverage Supplier ${randomUUID()}`,
      lines: [{ materialId: material.id, quantity: 10, rate: 100 }],
    };
  },
  approve_purchase_order: async (prisma) => {
    const po = await createPurchaseOrder(prisma, { status: 'PENDING_APPROVAL' });
    return { purchaseOrderId: po.id };
  },
  reject_purchase_order: async (prisma) => {
    const po = await createPurchaseOrder(prisma, { status: 'PENDING_APPROVAL' });
    return { purchaseOrderId: po.id, reason: 'audit-coverage test' };
  },
  record_goods_receipt: async (prisma) => {
    const material = await createMaterial(prisma);
    const supplier = await createSupplier(prisma);
    return {
      supplierId: supplier.id,
      receiptDate: new Date(),
      lines: [{ materialId: material.id, receivedQty: 10, acceptedQty: 10, rejectedQty: 0, rate: 5 }],
    };
  },
  issue_material: async (prisma) => {
    // No JobBomLine needed — an explicit line against a material with no BOM
    // entry is still a valid issue (just a top-up with outstanding 0), same
    // as issue-return.test.ts's own no-BOM-line coverage.
    const job = await createJob(prisma);
    const material = await createMaterial(prisma);
    return { jobId: job.id, lines: [{ materialId: material.id, quantity: 1 }] };
  },
  return_material: async (prisma) => {
    // return_material requires JobBomLine.issuedQty > 0 — set up that state
    // directly via Prisma (bypassing issue_material's own tool handler),
    // same convention as approve_purchase_order/reject_purchase_order below
    // seeding PENDING_APPROVAL directly rather than deriving it through
    // create_purchase_order.
    const job = await createJob(prisma);
    const material = await createMaterial(prisma);
    await prisma.jobBomLine.create({
      data: { jobId: job.id, materialId: material.id, qtyPerPiece: 1, requiredQty: 10, issuedQty: 10 },
    });
    return { jobId: job.id, lines: [{ materialId: material.id, quantity: 1 }] };
  },
  close_job: async (prisma) => {
    const job = await createJob(prisma);
    return { jobId: job.id };
  },
  record_scrap_in: async (prisma) => {
    const material = await createMaterial(prisma, { isScrap: true });
    return { materialId: material.id, quantity: 5 };
  },
  record_scrap_sale: async (prisma) => {
    const material = await createMaterial(prisma, { isScrap: true });
    return { materialId: material.id, quantity: 1, rate: 10, saleDate: new Date() };
  },
  start_stock_count: async () => ({ countDate: new Date() }),
  submit_count_line: async (prisma) => {
    const count = await createStockCount(prisma, { status: 'DRAFT', lines: [{ countedQty: null }] });
    return { stockCountLineId: count.lines[0].id, countedQty: 5 };
  },
  submit_stock_count: async (prisma) => {
    const count = await createStockCount(prisma, { status: 'DRAFT', lines: [{ countedQty: 10 }] });
    return { stockCountId: count.id };
  },
  approve_stock_count: async (prisma) => {
    const count = await createStockCount(prisma, { status: 'PENDING_APPROVAL', lines: [{ countedQty: 10 }] });
    return { stockCountId: count.id };
  },
  reject_stock_count: async (prisma) => {
    const count = await createStockCount(prisma, { status: 'PENDING_APPROVAL' });
    return { stockCountId: count.id, rejectionNote: 'audit-coverage test' };
  },
  reverse_movement: async (prisma) => {
    // Unlike most tools here, reverse_movement needs a pre-existing row to
    // act on — seed one directly via the Batch G test factory (bypassing the
    // tool layer, same convention as return_material's JobBomLine seeding
    // above).
    const movement = await createTestMovement(prisma);
    return { movementId: movement.id, reason: 'audit-coverage test' };
  },
};

// Constructed synchronously, at module scope — it.each's array argument
// below is evaluated while Jest collects tests, before any beforeAll runs,
// so the registry (pure metadata, no I/O) can't be built inside beforeAll
// the way db/prisma/ctx are.
const registry = new ToolRegistry();

describe('audit coverage (in-process)', () => {
  let db: TestDatabase;
  let prisma: PrismaClient;
  let ctx: ToolContext;
  // OWNER, not STOREKEEPER — approve_purchase_order/reject_purchase_order
  // are OWNER-only, and this suite calls every mutating+authed tool with
  // one shared caller so it needs the most-privileged role.
  let callerUserId: string;

  beforeAll(async () => {
    db = await startTestDatabase();
    prisma = getTestPrismaClient(db.connectionString);
    const user = await createTestUser(prisma, { role: 'OWNER' });
    callerUserId = user.userId;
    ctx = { userId: user.userId, email: user.email, role: user.role, prisma };
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await db.container.stop();
  });

  // requiresAuth: false tools (register today) are excluded: the real
  // router always calls them with ctx.userId: null regardless of any
  // caller, so they structurally can never produce actorType: 'HUMAN' /
  // actorId matching "the calling test user" the way every other mutating
  // tool here does — a different, dedicated concern from this file's own.
  function mutatingAuthedToolNames(): string[] {
    return registry
      .catalogForListing()
      .filter((entry) => entry.mutates)
      .map((entry) => entry.name)
      .filter((name) => registry.get(name)?.requiresAuth !== false);
  }

  it('has an ARGS_BUILDERS entry for every currently mutating, auth-required tool in the live registry', () => {
    const missing = mutatingAuthedToolNames().filter((name) => !(name in ARGS_BUILDERS));
    expect(missing).toEqual([]);
  });

  it.each(mutatingAuthedToolNames())('%s: exactly one new audited AuditEvent row is left behind', async (toolName) => {
    const tool = registry.get(toolName);
    expect(tool).toBeDefined();
    if (!tool) return;

    const builder = ARGS_BUILDERS[toolName];
    expect(builder).toBeDefined();
    if (!builder) return;

    const args = await builder(prisma);
    const before = await prisma.auditEvent.count();

    const result = await tool.handler(ctx, args);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`${toolName} unexpectedly failed: ${JSON.stringify(result)}`);
    }

    const after = await prisma.auditEvent.count();
    expect(after).toBe(before + 1);

    const event = await prisma.auditEvent.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
    expect(event.toolName).toBe(toolName);
    expect(event.actorType).toBe('HUMAN');
    expect(event.actorId).toBe(callerUserId);
  });

  it('never leaves an orphan AuditEvent row when the inner write fails', async () => {
    const before = await prisma.auditEvent.count();

    // A materialId that doesn't exist: tx.material.update throws inside
    // withAuditedTransaction's callback, so the whole transaction (write +
    // audit insert) rolls back together — Phase 0/1's "never audit a
    // failed write" guarantee, re-verified at this layer.
    const result = await updateMaterialTool.handler(ctx, { materialId: randomUUID(), name: 'should not be applied' });

    expect(result.ok).toBe(false);

    const after = await prisma.auditEvent.count();
    expect(after).toBe(before);
  });
});
