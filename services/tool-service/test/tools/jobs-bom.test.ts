import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { startTestDatabase, type TestDatabase } from '../infra/testDatabase.js';
import { getTestPrismaClient } from '../infra/prismaClient.js';
import { createTestUser } from '../infra/testUser.js';
import { createTestMaterial } from '../infra/testMaterial.js';
import { createMaterial } from '../factories/materials.js';
import { createCustomer } from '../factories/parties.js';
import { createJob } from '../factories/jobs.js';
import type { ToolContext } from '../../src/tools/types.js';
import createCustomerPoTool from '../../src/tools/plugins/create_customer_po.js';
import createJobTool from '../../src/tools/plugins/create_job.js';
import setJobBomTool from '../../src/tools/plugins/set_job_bom.js';
import checkJobShortageTool from '../../src/tools/plugins/check_job_shortage.js';
import getJobTool from '../../src/tools/plugins/get_job.js';
import getJobBomVarianceTool from '../../src/tools/plugins/get_job_bom_variance.js';

describe('jobs & BOM tools (in-process)', () => {
  let db: TestDatabase;
  let prisma: PrismaClient;
  let ctx: ToolContext;

  beforeAll(async () => {
    db = await startTestDatabase();
    prisma = getTestPrismaClient(db.connectionString);
    const user = await createTestUser(prisma, { role: 'STOREKEEPER' });
    ctx = { userId: user.userId, email: user.email, role: user.role, prisma };
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await db.container.stop();
  });

  describe('create_customer_po', () => {
    it('creates a new customer PO when given a fresh customerName (also exercises resolveOrCreateByName)', async () => {
      const customerName = `Jobs Test Customer ${randomUUID()}`;
      const number = `PO-JOBS-${randomUUID()}`;

      const result = await createCustomerPoTool.handler(ctx, { customerName, number });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const po = result.data as { id: string; number: string; customerId: string };
      expect(po.number).toBe(number);

      const customer = await prisma.party.findUniqueOrThrow({ where: { id: po.customerId } });
      expect(customer.isCustomer).toBe(true);
    });

    it('resolves an existing party case-insensitively by name rather than creating a duplicate party', async () => {
      const suffix = randomUUID();
      const existing = await createCustomer(prisma, { name: `Case Sensitive Co ${suffix}` });

      const result = await createCustomerPoTool.handler(ctx, {
        customerName: `  CASE sensitive CO ${suffix}  `.trim().toUpperCase(),
        number: `PO-JOBS-${randomUUID()}`,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const po = result.data as { customerId: string };
      expect(po.customerId).toBe(existing.id);

      const partyCount = await prisma.party.count({ where: { name: { equals: `Case Sensitive Co ${suffix}`, mode: 'insensitive' } } });
      expect(partyCount).toBe(1);
    });

    it('returns the existing PO (not a duplicate) on a repeated call with the same customer and number', async () => {
      const customer = await createCustomer(prisma);
      const number = `PO-JOBS-DUP-${randomUUID()}`;

      const first = await createCustomerPoTool.handler(ctx, { customerId: customer.id, number });
      expect(first.ok).toBe(true);
      if (!first.ok) return;

      const second = await createCustomerPoTool.handler(ctx, { customerId: customer.id, number });
      expect(second.ok).toBe(true);
      if (!second.ok) return;

      expect((second.data as { id: string }).id).toBe((first.data as { id: string }).id);
      const count = await prisma.customerPo.count({ where: { customerId: customer.id, number } });
      expect(count).toBe(1);
    });
  });

  describe('create_job', () => {
    it('creates a job with an auto-numbered JOB-<FY>-#### code', async () => {
      const customer = await createCustomer(prisma);

      const result = await createJobTool.handler(ctx, {
        customerId: customer.id,
        productDescription: 'Test widget',
        quantity: 50,
        jobDate: new Date('2026-05-01'),
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const job = result.data as { number: string };
      expect(job.number).toMatch(/^JOB-\d{4}-\d{4}$/);
    });

    it('returns INVALID_QTY for a non-positive quantity', async () => {
      const customer = await createCustomer(prisma);

      const result = await createJobTool.handler(ctx, {
        customerId: customer.id,
        productDescription: 'Test widget',
        quantity: 0,
        jobDate: new Date(),
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('INVALID_QTY');
    });

    it('returns PARENT_JOB_MISMATCH when type is SAMPLE but parentJobId belongs to a different customer', async () => {
      const customerA = await createCustomer(prisma);
      const customerB = await createCustomer(prisma);
      const parentJob = await createJob(prisma, { customerId: customerA.id });

      const result = await createJobTool.handler(ctx, {
        customerId: customerB.id,
        productDescription: 'Sample widget',
        quantity: 1,
        jobDate: new Date(),
        type: 'SAMPLE',
        parentJobId: parentJob.id,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('PARENT_JOB_MISMATCH');
    });

    it('creates a SAMPLE job when parentJobId resolves and belongs to the same customer', async () => {
      const customer = await createCustomer(prisma);
      const parentJob = await createJob(prisma, { customerId: customer.id });

      const result = await createJobTool.handler(ctx, {
        customerId: customer.id,
        productDescription: 'Sample widget',
        quantity: 1,
        jobDate: new Date(),
        type: 'SAMPLE',
        parentJobId: parentJob.id,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect((result.data as { type: string }).type).toBe('SAMPLE');
    });
  });

  describe('set_job_bom', () => {
    it('sets BOM lines on an OPEN job, computing requiredQty = qtyPerPiece × job.quantity', async () => {
      const job = await createJob(prisma, { quantity: 20 });
      const material = await createMaterial(prisma);

      const result = await setJobBomTool.handler(ctx, {
        jobId: job.id,
        lines: [{ materialId: material.id, qtyPerPiece: 3 }],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const lines = result.data as { requiredQty: unknown; materialId: string }[];
      expect(lines).toHaveLength(1);
      expect(Number(lines[0].requiredQty)).toBe(60);

      const stored = await prisma.jobBomLine.findUniqueOrThrow({ where: { jobId_materialId: { jobId: job.id, materialId: material.id } } });
      expect(Number(stored.requiredQty)).toBe(60);
    });

    it('returns JOB_NOT_OPEN when the job status is not OPEN', async () => {
      const job = await prisma.job.create({
        data: {
          number: `JOB-TEST-${randomUUID()}`,
          customerId: (await createCustomer(prisma)).id,
          productDescription: 'Closed job',
          quantity: 10,
          jobDate: new Date(),
          status: 'CLOSED',
        },
      });
      const material = await createMaterial(prisma);

      const result = await setJobBomTool.handler(ctx, { jobId: job.id, lines: [{ materialId: material.id, qtyPerPiece: 1 }] });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('JOB_NOT_OPEN');
    });

    it('returns INVALID_QTY when a line has a non-positive qtyPerPiece', async () => {
      const job = await createJob(prisma);
      const material = await createMaterial(prisma);

      const result = await setJobBomTool.handler(ctx, { jobId: job.id, lines: [{ materialId: material.id, qtyPerPiece: 0 }] });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('INVALID_QTY');
    });

    it('returns MATERIAL_NOT_FOUND when a line references an inactive material', async () => {
      const job = await createJob(prisma);
      const material = await createMaterial(prisma, { isActive: false });

      const result = await setJobBomTool.handler(ctx, { jobId: job.id, lines: [{ materialId: material.id, qtyPerPiece: 1 }] });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('MATERIAL_NOT_FOUND');
    });
  });

  describe('check_job_shortage', () => {
    it('computes shortfall as max(0, required - onHand) against zero on-hand stock', async () => {
      const job = await createJob(prisma, { quantity: 10 });
      const material = await createMaterial(prisma);
      await setJobBomTool.handler(ctx, { jobId: job.id, lines: [{ materialId: material.id, qtyPerPiece: 5 }] });

      const result = await checkJobShortageTool.handler(ctx, { jobId: job.id });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const rows = result.data as { materialId: string; required: number; onHand: number; shortfall: number }[];
      expect(rows).toHaveLength(1);
      expect(rows[0].required).toBe(50);
      expect(rows[0].onHand).toBe(0);
      expect(rows[0].shortfall).toBe(50);
    });

    it('computes a partial shortfall when some stock is already on hand', async () => {
      const job = await createJob(prisma, { quantity: 10 });
      const { material } = await createTestMaterial(prisma);
      await setJobBomTool.handler(ctx, { jobId: job.id, lines: [{ materialId: material.id, qtyPerPiece: 5 }] });
      // Post stock directly via Prisma (no issue_material tool exists yet) —
      // same pattern material-master.test.ts uses for deactivate_material's
      // MATERIAL_HAS_STOCK case.
      await prisma.stockMovement.create({
        data: {
          materialId: material.id,
          type: 'RECEIPT',
          direction: 'IN',
          quantity: 30,
          rate: 10,
          value: 0,
          balanceQtyAfter: 0,
          balanceRateAfter: 0,
          balanceValueAfter: 0,
          movementDate: new Date(),
        },
      });

      const result = await checkJobShortageTool.handler(ctx, { jobId: job.id });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const rows = result.data as { onHand: number; shortfall: number }[];
      expect(rows[0].onHand).toBe(30);
      expect(rows[0].shortfall).toBe(20); // required 50 - onHand 30
    });
  });

  describe('get_job', () => {
    it("includes BOM lines and a zeroed materialCostSummary for a job with no movements yet", async () => {
      const job = await createJob(prisma, { quantity: 5 });
      const material = await createMaterial(prisma);
      await setJobBomTool.handler(ctx, { jobId: job.id, lines: [{ materialId: material.id, qtyPerPiece: 2 }] });

      const result = await getJobTool.handler(ctx, { jobId: job.id });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as {
        bomLines: { materialId: string; requiredQty: unknown }[];
        materialCostSummary: { issued_value: unknown; returned_value: unknown; net_material_cost: unknown } | null;
      };
      expect(data.bomLines).toHaveLength(1);
      expect(Number(data.bomLines[0].requiredQty)).toBe(10);
      expect(data.materialCostSummary).not.toBeNull();
      expect(Number(data.materialCostSummary?.net_material_cost)).toBe(0);
    });

    it('returns JOB_NOT_FOUND for a nonexistent job', async () => {
      const result = await getJobTool.handler(ctx, { jobId: randomUUID() });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('JOB_NOT_FOUND');
    });
  });

  describe('get_job_bom_variance', () => {
    it('returns JOB_NOT_FOUND for a nonexistent job', async () => {
      const result = await getJobBomVarianceTool.handler(ctx, { jobId: randomUUID() });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('JOB_NOT_FOUND');
    });

    // Full "BOM vs. what was actually issued/returned" coverage needs
    // Batch D's issue_material/return_material tools, which don't exist
    // yet — job_bom_lines.issuedQty/returnedQty only ever move off their
    // schema default of 0 through those tools (per schema.prisma's own
    // comment: "running total of ISSUE − RETURN ... maintained by the tool
    // layer"), so faking non-zero values via a raw Prisma update would
    // exercise data no real tool can currently produce. This only checks
    // the zero-issuance shape: a freshly-set BOM line with nothing issued
    // yet, so 100% of bom_required is still outstanding.
    it('reports full variance against bom_required when nothing has been issued yet (zero-issuance case; Batch D-dependent scenarios deferred)', async () => {
      const job = await createJob(prisma, { quantity: 10 });
      const material = await createMaterial(prisma);
      await setJobBomTool.handler(ctx, { jobId: job.id, lines: [{ materialId: material.id, qtyPerPiece: 4 }] });

      const result = await getJobBomVarianceTool.handler(ctx, { jobId: job.id });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const rows = result.data as { bom_required: unknown; actually_issued: unknown; returned: unknown; variance: unknown }[];
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].bom_required)).toBe(40);
      expect(Number(rows[0].actually_issued)).toBe(0);
      expect(Number(rows[0].returned)).toBe(0);
      expect(Number(rows[0].variance)).toBe(-40);
    });
  });
});
