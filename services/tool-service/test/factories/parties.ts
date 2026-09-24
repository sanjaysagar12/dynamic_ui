import { randomUUID } from 'node:crypto';
import type { Party, PrismaClient } from '@prisma/client';
import { partyNameKey } from '../../src/lib/partyName.js';

export interface CreatePartyOverrides {
  code?: string;
  name?: string;
  gstin?: string | null;
  isActive?: boolean;
}

export async function createSupplier(prisma: PrismaClient, overrides: CreatePartyOverrides = {}): Promise<Party> {
  const suffix = randomUUID().slice(0, 8);
  return prisma.party.create({
    data: {
      code: overrides.code ?? `PTY-TEST-${suffix}`,
      name: overrides.name ?? `Test Supplier ${suffix}`,
      nameKey: partyNameKey(overrides.name ?? `Test Supplier ${suffix}`),
      isSupplier: true,
      isCustomer: false,
      gstin: overrides.gstin ?? undefined,
      isActive: overrides.isActive ?? true,
    },
  });
}

export async function createCustomer(prisma: PrismaClient, overrides: CreatePartyOverrides = {}): Promise<Party> {
  const suffix = randomUUID().slice(0, 8);
  return prisma.party.create({
    data: {
      code: overrides.code ?? `PTY-TEST-${suffix}`,
      name: overrides.name ?? `Test Customer ${suffix}`,
      nameKey: partyNameKey(overrides.name ?? `Test Customer ${suffix}`),
      isSupplier: false,
      isCustomer: true,
      gstin: overrides.gstin ?? undefined,
      isActive: overrides.isActive ?? true,
    },
  });
}
