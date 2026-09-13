import type { Job, JobBomLine, PrismaClient } from '@prisma/client';
import { createJob, type CreateJobOverrides } from '../factories/jobs.js';

/**
 * Thin wrapper around the Phase 0 factory (createJob), for parity with
 * testMaterial.ts/testUser.ts's naming convention — createJob already
 * defaults to status: OPEN and a sane quantity (the Job model's own schema
 * default plus the factory's own 100), so there's nothing extra to fetch
 * back here the way testMaterial.ts fetches the auto-provisioned balance.
 */
export async function createTestJob(prisma: PrismaClient, overrides: CreateJobOverrides = {}): Promise<Job> {
  return createJob(prisma, overrides);
}

export interface CreateTestJobBomLineOverrides {
  jobId: string;
  materialId: string;
  qtyPerPiece?: number;
  requiredQty?: number;
}

/**
 * Creates one JobBomLine row directly via Prisma, bypassing set_job_bom's
 * own tool handler entirely — Batch B's Layer 2 tests aren't in scope for
 * this batch (see the Batch D prompt's "explicitly out of scope"), so
 * issue_material/return_material/close_job's own tests build BOM fixtures
 * this way instead of depending on set_job_bom's tests existing.
 * requiredQty defaults to qtyPerPiece × the job's own quantity when not
 * given explicitly, mirroring set_job_bom.ts's real formula.
 */
export async function createTestJobBomLine(
  prisma: PrismaClient,
  overrides: CreateTestJobBomLineOverrides,
): Promise<JobBomLine> {
  const qtyPerPiece = overrides.qtyPerPiece ?? 1;
  let requiredQty = overrides.requiredQty;
  if (requiredQty === undefined) {
    const job = await prisma.job.findUniqueOrThrow({ where: { id: overrides.jobId } });
    requiredQty = qtyPerPiece * job.quantity;
  }
  return prisma.jobBomLine.create({
    data: { jobId: overrides.jobId, materialId: overrides.materialId, qtyPerPiece, requiredQty },
  });
}
