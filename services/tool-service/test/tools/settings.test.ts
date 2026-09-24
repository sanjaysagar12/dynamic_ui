import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { startTestDatabase, type TestDatabase } from '../infra/testDatabase.js';
import { getTestPrismaClient } from '../infra/prismaClient.js';
import { createTestUser } from '../infra/testUser.js';
import { createMaterial } from '../factories/materials.js';
import { createSupplier } from '../factories/parties.js';
import type { ToolContext } from '../../src/tools/types.js';
import listSettingsTool from '../../src/tools/plugins/list_settings.js';
import updateSettingTool from '../../src/tools/plugins/update_setting.js';
import createPurchaseOrderTool from '../../src/tools/plugins/create_purchase_order.js';

describe('settings tools (in-process)', () => {
  let db: TestDatabase;
  let prisma: PrismaClient;
  let storekeeperCtx: ToolContext;
  let ownerCtx: ToolContext;

  beforeAll(async () => {
    db = await startTestDatabase();
    prisma = getTestPrismaClient(db.connectionString);
    const storekeeper = await createTestUser(prisma, { role: 'STOREKEEPER' });
    storekeeperCtx = { userId: storekeeper.userId, email: storekeeper.email, role: storekeeper.role, prisma };
    const owner = await createTestUser(prisma, { role: 'OWNER' });
    ownerCtx = { userId: owner.userId, email: owner.email, role: owner.role, prisma };
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await db.container.stop();
  });

  describe('list_settings', () => {
    it('returns the seeded threshold correctly, readable by any role', async () => {
      const seeded = await updateSettingTool.handler(ownerCtx, { key: 'po.approval_threshold_inr', value: '123456' });
      expect(seeded.ok).toBe(true);

      const result = await listSettingsTool.handler(storekeeperCtx, {});

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const rows = result.data as { key: string; value: string }[];
      const threshold = rows.find((r) => r.key === 'po.approval_threshold_inr');
      expect(threshold?.value).toBe('123456');
    });
  });

  describe('update_setting', () => {
    it('as OWNER with a valid key/value succeeds, and a follow-up list_settings reflects the change', async () => {
      const result = await updateSettingTool.handler(ownerCtx, { key: 'po.approval_threshold_inr', value: '99000' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect((result.data as { value: string }).value).toBe('99000');

      const listed = await listSettingsTool.handler(ownerCtx, {});
      expect(listed.ok).toBe(true);
      if (!listed.ok) return;
      const rows = listed.data as { key: string; value: string }[];
      expect(rows.find((r) => r.key === 'po.approval_threshold_inr')?.value).toBe('99000');
    });

    it('returns FORBIDDEN_NOT_OWNER for a non-owner caller (handler-level check, defense-in-depth below the router)', async () => {
      const before = await prisma.setting.findUniqueOrThrow({ where: { key: 'po.approval_threshold_inr' } });

      const result = await updateSettingTool.handler(storekeeperCtx, { key: 'po.approval_threshold_inr', value: '1' });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('FORBIDDEN_NOT_OWNER');

      const after = await prisma.setting.findUniqueOrThrow({ where: { key: 'po.approval_threshold_inr' } });
      expect(after.value).toBe(before.value); // nothing written
    });

    it('returns UNKNOWN_SETTING_KEY for an unrecognized key, and creates no row', async () => {
      const bogusKey = `something.made.up.${randomUUID()}`;
      const before = await prisma.setting.count();

      const result = await updateSettingTool.handler(ownerCtx, { key: bogusKey, value: '1' });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('UNKNOWN_SETTING_KEY');

      const after = await prisma.setting.count();
      expect(after).toBe(before);
      expect(await prisma.setting.findUnique({ where: { key: bogusKey } })).toBeNull();
    });

    it('returns INVALID_SETTING_VALUE for a non-numeric value on po.approval_threshold_inr, and writes nothing', async () => {
      const before = await prisma.setting.findUniqueOrThrow({ where: { key: 'po.approval_threshold_inr' } });

      const result = await updateSettingTool.handler(ownerCtx, { key: 'po.approval_threshold_inr', value: 'not-a-number' });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('INVALID_SETTING_VALUE');

      const after = await prisma.setting.findUniqueOrThrow({ where: { key: 'po.approval_threshold_inr' } });
      expect(after.value).toBe(before.value); // nothing written
    });

    // The actual reported bug: an OWNER's chat-driven change to the approval limit must be the
    // SAME value create_purchase_order reads — not two independently-drifting reads of Setting.
    it('regression: create_purchase_order agrees with a threshold just set via update_setting', async () => {
      const setResult = await updateSettingTool.handler(ownerCtx, { key: 'po.approval_threshold_inr', value: '10000' });
      expect(setResult.ok).toBe(true);

      const material = await createMaterial(prisma);
      const supplier = await createSupplier(prisma, { name: `Settings Test Supplier ${randomUUID()}` });

      const result = await createPurchaseOrderTool.handler(storekeeperCtx, {
        supplierName: supplier.name,
        lines: [{ materialId: material.id, quantity: 1, rate: 10001 }], // totalValue 10001, just above 10000
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect((result.data as { status: string }).status).toBe('PENDING_APPROVAL');
    });
  });
});
