import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { startTestDatabase, type TestDatabase } from '../infra/testDatabase.js';
import { getTestPrismaClient } from '../infra/prismaClient.js';
import { createTestUser } from '../infra/testUser.js';
import { createMaterial } from '../factories/materials.js';
import { createCustomer, createSupplier } from '../factories/parties.js';
import type { ToolContext } from '../../src/tools/types.js';
import { partyNameKey } from '../../src/lib/partyName.js';
import createPartyTool from '../../src/tools/plugins/create_party.js';
import updatePartyTool from '../../src/tools/plugins/update_party.js';
import deactivatePartyTool from '../../src/tools/plugins/deactivate_party.js';
import searchPartiesTool from '../../src/tools/plugins/search_parties.js';
import createPurchaseOrderTool from '../../src/tools/plugins/create_purchase_order.js';

// Every name here carries a unique tag so tests can't collide through nameKey.
const tag = () => randomUUID().slice(0, 8).replace(/[^a-z]/g, 'x');

describe('partyNameKey', () => {
  it.each([
    ['Sundaram Ferrites', 'sundaramferrites'],
    ['M/s. Sundaram Ferrites Pvt. Ltd.', 'sundaramferrites'],
    ['SUNDARAM  FERRITES.', 'sundaramferrites'],
    ['Chennai Copper Wires Private Limited', 'chennaicopperwires'],
    ['Ravi & Co', 'ravi'],
    ['ABC Industries Ltd', 'abcindustries'],
  ])('%s → %s', (input, expected) => {
    expect(partyNameKey(input)).toBe(expected);
  });

  it('keeps a city that was typed into the name, so it is caught as SIMILAR rather than silently merged', () => {
    expect(partyNameKey('Sundaram Ferrites, Chennai')).toBe('sundaramferriteschennai');
  });
});

describe('supplier & customer tools (in-process)', () => {
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

  describe('create_party', () => {
    it('creates a supplier with GSTIN (uppercased) and city, and never returns the internal code', async () => {
      const name = `Sundaram Ferrites ${tag()}`;
      const result = await createPartyTool.handler(ctx, {
        name,
        role: 'SUPPLIER',
        gstin: '33aaacs1234k1z2',
        city: 'Chennai',
        confirmNotDuplicate: false,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as Record<string, unknown>;
      expect(data.outcome).toBe('CREATED');
      expect(data).not.toHaveProperty('code');
      const saved = await prisma.party.findFirstOrThrow({ where: { name } });
      expect(saved.gstin).toBe('33AAACS1234K1Z2');
      expect(saved.city).toBe('Chennai');
      expect(saved.isSupplier).toBe(true);
      expect(saved.isCustomer).toBe(false);
      expect(saved.nameKey).toBe(partyNameKey(name));
    });

    it('rejects a malformed GSTIN with INVALID_GSTIN', async () => {
      const result = await createPartyTool.handler(ctx, {
        name: `Bad Gstin Traders ${tag()}`,
        role: 'SUPPLIER',
        gstin: '33ABC',
        confirmNotDuplicate: false,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('INVALID_GSTIN');
    });

    it('refuses the same business under a different spelling (Pvt Ltd, M/s, case) with PARTY_EXISTS', async () => {
      const base = `Ravi Insulation ${tag()}`;
      await createSupplier(prisma, { name: base });

      const result = await createPartyTool.handler(ctx, {
        name: `M/s. ${base.toUpperCase()} Pvt. Ltd.`,
        role: 'SUPPLIER',
        confirmNotDuplicate: false,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('PARTY_EXISTS');
      expect(await prisma.party.count({ where: { nameKey: partyNameKey(base) } })).toBe(1);
    });

    it('flags "Name, City" as SIMILAR_PARTY_EXISTS, then allows it once confirmed as a different business', async () => {
      const base = `Chennai Copper ${tag()}`;
      await createSupplier(prisma, { name: base });

      const first = await createPartyTool.handler(ctx, { name: `${base}, Chennai`, role: 'SUPPLIER', confirmNotDuplicate: false });
      expect(first.ok).toBe(false);
      if (first.ok) return;
      expect(first.code).toBe('SIMILAR_PARTY_EXISTS');
      expect(first.error).toContain(base);

      const confirmed = await createPartyTool.handler(ctx, { name: `${base}, Chennai`, role: 'SUPPLIER', confirmNotDuplicate: true });
      expect(confirmed.ok).toBe(true);
    });

    it('adds the missing type to an existing business instead of creating a second entry', async () => {
      const customer = await createCustomer(prisma, { name: `Murugan Metal ${tag()}` });

      const result = await createPartyTool.handler(ctx, { name: customer.name, role: 'SUPPLIER', confirmNotDuplicate: false });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect((result.data as { outcome: string }).outcome).toBe('TYPE_ADDED');
      const after = await prisma.party.findUniqueOrThrow({ where: { id: customer.id } });
      expect(after.isCustomer).toBe(true);
      expect(after.isSupplier).toBe(true);
    });

    it('treats the same GSTIN as the same business even under a different name', async () => {
      const gstin = `33AAACS${String(Math.floor(Math.random() * 9000) + 1000)}K1Z2`;
      await createSupplier(prisma, { name: `Original Name ${tag()}`, gstin });

      const result = await createPartyTool.handler(ctx, { name: `Totally Different ${tag()}`, role: 'SUPPLIER', gstin, confirmNotDuplicate: false });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('PARTY_EXISTS');
    });

    it('writes exactly one audit event', async () => {
      const name = `Audit Party ${tag()}`;
      const result = await createPartyTool.handler(ctx, { name, role: 'CUSTOMER', confirmNotDuplicate: false });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const id = (result.data as { id: string }).id;
      expect(await prisma.auditEvent.count({ where: { entityType: 'Party', entityId: id } })).toBe(1);
    });
  });

  describe('purchase orders no longer create suppliers', () => {
    it('create_purchase_order with an unknown supplier name fails with PARTY_NOT_FOUND and creates nothing', async () => {
      const material = await createMaterial(prisma);
      const before = await prisma.party.count();

      const result = await createPurchaseOrderTool.handler(ctx, {
        supplierName: `Never Added Supplier ${tag()}`,
        lines: [{ materialId: material.id, quantity: 1, rate: 1 }],
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('PARTY_NOT_FOUND');
      expect(await prisma.party.count()).toBe(before);
    });

    it('finds an existing supplier by a different spelling ("Pvt Ltd", case)', async () => {
      const supplier = await createSupplier(prisma, { name: `Kovai Ferrites ${tag()}` });
      const material = await createMaterial(prisma);

      const result = await createPurchaseOrderTool.handler(ctx, {
        supplierName: `${supplier.name.toUpperCase()} Pvt Ltd`,
        lines: [{ materialId: material.id, quantity: 1, rate: 1 }],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect((result.data as { supplierId: string }).supplierId).toBe(supplier.id);
    });

    it('refuses a customer-only party as a supplier with PARTY_WRONG_ROLE', async () => {
      const customer = await createCustomer(prisma, { name: `Only A Customer ${tag()}` });
      const material = await createMaterial(prisma);

      const result = await createPurchaseOrderTool.handler(ctx, {
        supplierName: customer.name,
        lines: [{ materialId: material.id, quantity: 1, rate: 1 }],
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('PARTY_WRONG_ROLE');
    });
  });

  describe('update_party', () => {
    it('splits a city out of the name', async () => {
      const base = `Split Me Traders ${tag()}`;
      const party = await createSupplier(prisma, { name: `${base}, Chennai` });

      const result = await updatePartyTool.handler(ctx, { partyId: party.id, name: base, city: 'Chennai', confirmNotDuplicate: false });

      expect(result.ok).toBe(true);
      const after = await prisma.party.findUniqueOrThrow({ where: { id: party.id } });
      expect(after.name).toBe(base);
      expect(after.city).toBe('Chennai');
      expect(after.nameKey).toBe(partyNameKey(base));
    });

    it('refuses a rename onto another existing business', async () => {
      const a = await createSupplier(prisma, { name: `First Business ${tag()}` });
      const b = await createSupplier(prisma, { name: `Second Business ${tag()}` });

      const result = await updatePartyTool.handler(ctx, { partyId: b.id, name: a.name, confirmNotDuplicate: false });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('DUPLICATE_PARTY');
    });

    it('refuses a GSTIN already used by another party', async () => {
      const gstin = `33AAACT${String(Math.floor(Math.random() * 9000) + 1000)}K1Z2`;
      await createSupplier(prisma, { gstin });
      const other = await createSupplier(prisma);

      const result = await updatePartyTool.handler(ctx, { partyId: other.id, gstin, confirmNotDuplicate: false });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('DUPLICATE_GSTIN');
    });
  });

  describe('deactivate_party', () => {
    it('deactivates a party with no open work and hides it from search_parties', async () => {
      const party = await createSupplier(prisma, { name: `Old Vendor ${tag()}` });

      const result = await deactivatePartyTool.handler(ctx, { partyId: party.id, reason: 'no longer used' });
      expect(result.ok).toBe(true);

      const search = await searchPartiesTool.handler(ctx, { query: party.name, role: 'ANY', includeInactive: false });
      expect(search.ok).toBe(true);
      if (!search.ok) return;
      expect((search.data as { id: string }[]).some((p) => p.id === party.id)).toBe(false);
    });
  });

  describe('search_parties', () => {
    it('matches ignoring case and "Pvt Ltd", filters by role, and never returns the internal code', async () => {
      const supplier = await createSupplier(prisma, { name: `Search Target ${tag()}` });

      const result = await searchPartiesTool.handler(ctx, {
        query: `${supplier.name.toLowerCase()} pvt ltd`,
        role: 'SUPPLIER',
        includeInactive: false,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const rows = result.data as Record<string, unknown>[];
      expect(rows.map((r) => r.id)).toContain(supplier.id);
      rows.forEach((r) => expect(r).not.toHaveProperty('code'));

      const asCustomer = await searchPartiesTool.handler(ctx, { query: supplier.name, role: 'CUSTOMER', includeInactive: false });
      expect(asCustomer.ok).toBe(true);
      if (!asCustomer.ok) return;
      expect((asCustomer.data as { id: string }[]).some((p) => p.id === supplier.id)).toBe(false);
    });
  });
});
