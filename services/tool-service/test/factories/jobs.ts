import { randomUUID } from 'node:crypto';
import type { Job, PrismaClient } from '@prisma/client';
import { createCustomer } from './parties.js';

export interface CreateJobOverrides {
  number?: string;
  customerId?: string;
  productDescription?: string;
  quantity?: number;
  jobDate?: Date;
}

/**
 * Depends on a customer (Party with isCustomer: true) existing — if
 * `overrides.customerId` isn't given, creates one via createCustomer.
 */
export async function createJob(prisma: PrismaClient, overrides: CreateJobOverrides = {}): Promise<Job> {
  const suffix = randomUUID().slice(0, 8);
  const customerId = overrides.customerId ?? (await createCustomer(prisma)).id;

  return prisma.job.create({
    data: {
      number: overrides.number ?? `JOB-TEST-${suffix}`,
      customerId,
      productDescription: overrides.productDescription ?? `Test product ${suffix}`,
      quantity: overrides.quantity ?? 100,
      jobDate: overrides.jobDate ?? new Date(),
    },
  });
}
