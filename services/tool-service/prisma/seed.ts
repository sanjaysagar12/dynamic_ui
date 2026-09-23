// prisma/seed.ts — Prisma's own seed convention (wired via package.json's
// "prisma": { "seed": "tsx prisma/seed.ts" }), picked up automatically by
// `prisma migrate reset`. Also runnable directly via `npm run db:seed`.
//
// Every step below calls the REAL tool handlers
// (`tool.handler(ctx, args)`), in-process, the same way Layer 2's own tests
// do — this file is a live proof the tool catalog works end to end, not a
// data dump that happens to look right. The only direct Prisma writes are
// for things no tool creates yet (the Setting row).
//
// See ARCHITECTURE.md → "Planned test layout" → Phase 7: this script (plus
// reset-soft.ts/reset-full.ts) is the whole of that phase's code artifact.
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { config as loadDotenv } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { assertLocalDatabase } from './lib/localDbGuard.js';
import type { ToolContext, ToolResult } from '../src/tools/types.js';

import registerTool from '../src/tools/plugins/register.js';
import createMaterialTool from '../src/tools/plugins/create_material.js';
import createCustomerPoTool from '../src/tools/plugins/create_customer_po.js';
import createJobTool from '../src/tools/plugins/create_job.js';
import setJobBomTool from '../src/tools/plugins/set_job_bom.js';
import checkJobShortageTool from '../src/tools/plugins/check_job_shortage.js';
import createPurchaseOrderTool from '../src/tools/plugins/create_purchase_order.js';
import recordGoodsReceiptTool from '../src/tools/plugins/record_goods_receipt.js';
import startStockCountTool from '../src/tools/plugins/start_stock_count.js';
import submitCountLineTool from '../src/tools/plugins/submit_count_line.js';
import submitStockCountTool from '../src/tools/plugins/submit_stock_count.js';
import approveStockCountTool from '../src/tools/plugins/approve_stock_count.js';
import getMaterialBalanceTool from '../src/tools/plugins/get_material_balance.js';

loadDotenv({ path: resolve(__dirname, '../.env') });
assertLocalDatabase(process.env.DATABASE_URL);

const prisma = new PrismaClient();

const OWNER_EMAIL = 'owner@vijaya.test';
const OWNER_PASSWORD = 'VijayaOwner#2026';
const STOREKEEPER_EMAIL = 'storekeeper@vijaya.test';
const STOREKEEPER_PASSWORD = 'VijayaStore#2026';

const systemCtx: ToolContext = { userId: null, email: null, role: null, prisma };

function expectOk<T>(result: ToolResult, label: string): T {
  if (!result.ok) {
    throw new Error(`Seed step failed — ${label}: [${result.code}] ${result.error}`);
  }
  return result.data as T;
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function main() {
  const summary: Record<string, unknown> = {};

  // ═══════════════════════════════════════════════════════════════
  // 1. Identity
  // ═══════════════════════════════════════════════════════════════
  console.log('\n── 1. Identity ──');

  // register now grants OWNER automatically to the very first account
  // created on a fresh deployment (see the fix for "Anyone can register as
  // OWNER" in the security review) — it no longer accepts a `role` argument
  // at all. That only produces an OWNER here if the User table is genuinely
  // empty at this point; if seeding ever runs against a non-empty database,
  // this would silently produce a STOREKEEPER instead of the intended OWNER,
  // so assert the precondition explicitly and fail loudly rather than let
  // that happen quietly.
  const preSeedUserCount = await prisma.user.count();
  if (preSeedUserCount !== 0) {
    throw new Error(
      `Seed script expects an empty User table before bootstrapping the OWNER account, found ${preSeedUserCount} — ` +
        'run db:reset:soft or db:reset:full first, don\'t seed against a non-empty database.',
    );
  }

  const ownerAuth = expectOk<{ accessToken: string; userId: string; email: string; role: string }>(
    await registerTool.handler(systemCtx, { email: OWNER_EMAIL, password: OWNER_PASSWORD }),
    'register owner',
  );
  console.log(`  owner registered: ${ownerAuth.email} (${ownerAuth.userId})`);

  const storekeeperAuth = expectOk<{ accessToken: string; userId: string; email: string; role: string }>(
    await registerTool.handler(systemCtx, {
      email: STOREKEEPER_EMAIL,
      password: STOREKEEPER_PASSWORD,
    }),
    'register storekeeper',
  );
  console.log(`  storekeeper registered: ${storekeeperAuth.email} (${storekeeperAuth.userId})`);

  const ownerCtx: ToolContext = { userId: ownerAuth.userId, email: ownerAuth.email, role: 'OWNER', prisma };

  summary.users = {
    owner: { email: OWNER_EMAIL, password: OWNER_PASSWORD, userId: ownerAuth.userId, role: 'OWNER' },
    storekeeper: {
      email: STOREKEEPER_EMAIL,
      password: STOREKEEPER_PASSWORD,
      userId: storekeeperAuth.userId,
      role: 'STOREKEEPER',
    },
  };

  // ═══════════════════════════════════════════════════════════════
  // 2. Settings — no tool manages Setting yet, direct Prisma write.
  //    Must happen before any create_purchase_order call: that tool
  //    treats a MISSING setting as threshold 0 (conservatively requiring
  //    approval on everything), which would defeat step 5's "auto-approved
  //    below threshold" opening PO.
  // ═══════════════════════════════════════════════════════════════
  console.log('\n── 2. Settings ──');

  // upsert, not create: a db:seed-only run (no reset first) against a
  // database that already has this setting from a prior run must not crash
  // on the unique `key` constraint — reseeding should be idempotent here.
  await prisma.setting.upsert({
    where: { key: 'po.approval_threshold_inr' },
    create: {
      key: 'po.approval_threshold_inr',
      value: '50000',
      valueType: 'number',
      description: 'Purchase orders above this INR value require OWNER approval before being marked APPROVED.',
    },
    update: {
      value: '50000',
      valueType: 'number',
      description: 'Purchase orders above this INR value require OWNER approval before being marked APPROVED.',
    },
  });
  console.log('  po.approval_threshold_inr = 50000');
  summary.settings = { 'po.approval_threshold_inr': '50000' };

  // ═══════════════════════════════════════════════════════════════
  // 3. Materials
  // ═══════════════════════════════════════════════════════════════
  console.log('\n── 3. Materials ──');

  const wire = expectOk<{ id: string; code: string; name: string }>(
    await createMaterialTool.handler(ownerCtx, {
      name: '22 SWG Copper Wire',
      uom: 'KG',
      stockType: 'STANDING',
      minimumLevel: 50,
    }),
    'create material: 22 SWG Copper Wire',
  );

  const ferrite = expectOk<{ id: string; code: string; name: string }>(
    await createMaterialTool.handler(ownerCtx, {
      name: 'Ferrite Core E-30',
      uom: 'NOS',
      stockType: 'STANDING',
      minimumLevel: 500,
    }),
    'create material: Ferrite Core E-30',
  );

  const bobbin = expectOk<{ id: string; code: string; name: string }>(
    await createMaterialTool.handler(ownerCtx, {
      name: 'Bobbin Type B',
      uom: 'NOS',
      stockType: 'PER_JOB',
    }),
    'create material: Bobbin Type B',
  );

  const varnish = expectOk<{ id: string; code: string; name: string }>(
    await createMaterialTool.handler(ownerCtx, {
      name: 'Insulation Varnish',
      uom: 'LTR',
      stockType: 'STANDING',
      minimumLevel: 20,
    }),
    'create material: Insulation Varnish',
  );

  const copperScrap = expectOk<{ id: string; code: string; name: string }>(
    await createMaterialTool.handler(ownerCtx, {
      name: 'Copper Scrap',
      uom: 'KG',
      stockType: 'PER_JOB',
      isScrap: true,
    }),
    'create material: Copper Scrap',
  );

  for (const m of [wire, ferrite, bobbin, varnish, copperScrap]) {
    console.log(`  ${m.code} — ${m.name}`);
  }

  // Deliberate near-duplicate — MUST be rejected. This doubles as a smoke
  // test: if create_material's dedupe precondition ever regresses, this
  // throws and the seed fails loudly instead of silently seeding a
  // duplicate.
  //
  // Case-only variant, same spacing: the dedupe check (findMaterialsByName,
  // search_materials.ts) is a case-insensitive Prisma `contains`, which only
  // folds case — it does NOT normalize whitespace. A spacing difference
  // ("22swg" vs "22 SWG") would NOT be a substring match and would slip
  // through, so the near-duplicate here differs only in case to actually
  // exercise the precondition it's meant to smoke-test.
  const DUPLICATE_NAME = '22 SWG COPPER WIRE';
  const duplicateAttempt = await createMaterialTool.handler(ownerCtx, {
    name: DUPLICATE_NAME,
    uom: 'KG',
    stockType: 'STANDING',
    minimumLevel: 50,
  });
  if (duplicateAttempt.ok) {
    throw new Error(
      `REGRESSION: create_material accepted a near-duplicate name ("${DUPLICATE_NAME}") that should have been ` +
        'rejected as DUPLICATE_MATERIAL_SUSPECTED — the dedupe precondition is broken.',
    );
  }
  if (duplicateAttempt.code !== 'DUPLICATE_MATERIAL_SUSPECTED') {
    throw new Error(`Expected duplicate-material attempt to fail with DUPLICATE_MATERIAL_SUSPECTED, got ${duplicateAttempt.code}`);
  }
  console.log(`  duplicate-name rejection confirmed: "${DUPLICATE_NAME}" → ${duplicateAttempt.code}`);

  summary.materials = {
    wire: { id: wire.id, code: wire.code, name: wire.name },
    ferrite: { id: ferrite.id, code: ferrite.code, name: ferrite.name },
    bobbin: { id: bobbin.id, code: bobbin.code, name: bobbin.name },
    varnish: { id: varnish.id, code: varnish.code, name: varnish.name },
    copperScrap: { id: copperScrap.id, code: copperScrap.code, name: copperScrap.name },
    duplicateRejectionConfirmed: true,
  };

  // ═══════════════════════════════════════════════════════════════
  // 4/5. Suppliers + opening purchase + receipt
  //    Chennai Wire Traders is created here via create_purchase_order's
  //    own resolveOrCreateByName(supplierName) path — no separate step.
  // ═══════════════════════════════════════════════════════════════
  console.log('\n── 4/5. Opening purchase + receipt ──');

  const openingPo = expectOk<{
    id: string;
    number: string;
    supplierId: string;
    status: string;
    totalValue: string;
    lines: { id: string; materialId: string }[];
  }>(
    await createPurchaseOrderTool.handler(ownerCtx, {
      supplierName: 'Chennai Wire Traders',
      lines: [
        { materialId: wire.id, quantity: 20, rate: 850, gstRate: 18 },
        { materialId: ferrite.id, quantity: 300, rate: 18, gstRate: 18 },
      ],
      expectedDate: daysFromNow(-3),
    }),
    'create opening purchase order',
  );
  if (openingPo.status !== 'APPROVED') {
    throw new Error(`Expected opening PO to auto-approve below the ₹50,000 threshold, got status ${openingPo.status}`);
  }
  console.log(`  ${openingPo.number} — Chennai Wire Traders — ₹${openingPo.totalValue} — ${openingPo.status}`);

  const wirePoLine = openingPo.lines.find((l) => l.materialId === wire.id)!;
  const ferritePoLine = openingPo.lines.find((l) => l.materialId === ferrite.id)!;

  const openingGrn = expectOk<{
    id: string;
    number: string;
    lines: { id: string; materialId: string }[];
  }>(
    await recordGoodsReceiptTool.handler(ownerCtx, {
      supplierId: openingPo.supplierId,
      purchaseOrderId: openingPo.id,
      receiptDate: daysFromNow(-1),
      supplierInvoiceNo: 'CWT/2026/0417',
      lines: [
        { materialId: wire.id, purchaseOrderLineId: wirePoLine.id, receivedQty: 20, acceptedQty: 20, rejectedQty: 0, rate: 850, gstRate: 18 },
        { materialId: ferrite.id, purchaseOrderLineId: ferritePoLine.id, receivedQty: 300, acceptedQty: 300, rejectedQty: 0, rate: 18, gstRate: 18 },
      ],
    }),
    'record opening goods receipt',
  );
  console.log(`  ${openingGrn.number} — fully accepted, both lines`);

  const wireGrnLine = openingGrn.lines.find((l) => l.materialId === wire.id)!;

  const wireReceiptMovement = await prisma.stockMovement.findFirstOrThrow({
    where: { grnLineId: wireGrnLine.id, type: 'RECEIPT' },
  });

  summary.suppliers = { chennaiWireTraders: { id: openingPo.supplierId, name: 'Chennai Wire Traders' } };
  summary.openingPurchaseOrder = {
    number: openingPo.number,
    id: openingPo.id,
    status: openingPo.status,
    totalValue: openingPo.totalValue,
  };
  summary.openingGoodsReceipt = { number: openingGrn.number, id: openingGrn.id };
  summary.reversibleMovement = {
    id: wireReceiptMovement.id,
    type: wireReceiptMovement.type,
    material: '22 SWG Copper Wire',
    quantity: wireReceiptMovement.quantity.toString(),
    grnNumber: openingGrn.number,
    supplierName: 'Chennai Wire Traders',
  };

  // ═══════════════════════════════════════════════════════════════
  // 4 (cont.). Two more customers — realistic master data with no job
  //    attached yet, created via create_customer_po's own
  //    resolveOrCreateByName(customerName) path.
  // ═══════════════════════════════════════════════════════════════
  console.log('\n── 4. Additional customers ──');

  const brightLedPo = expectOk<{ id: string; number: string; customerId: string }>(
    await createCustomerPoTool.handler(ownerCtx, {
      customerName: 'BrightLED Solutions',
      number: 'BLS-PO-0118',
      poDate: daysFromNow(-10),
    }),
    'create customer PO: BrightLED Solutions',
  );
  const sunPowerPo = expectOk<{ id: string; number: string; customerId: string }>(
    await createCustomerPoTool.handler(ownerCtx, {
      customerName: 'SunPower Solar Pvt Ltd',
      number: 'SPS-PO-0042',
      poDate: daysFromNow(-6),
    }),
    'create customer PO: SunPower Solar Pvt Ltd',
  );
  console.log(`  BrightLED Solutions — ${brightLedPo.number}`);
  console.log(`  SunPower Solar Pvt Ltd — ${sunPowerPo.number}`);

  summary.customers = {
    brightLedSolutions: { id: brightLedPo.customerId, name: 'BrightLED Solutions', customerPoNumber: brightLedPo.number },
    sunPowerSolar: { id: sunPowerPo.customerId, name: 'SunPower Solar Pvt Ltd', customerPoNumber: sunPowerPo.number },
  };

  // ═══════════════════════════════════════════════════════════════
  // 6. Job with a shortage still standing
  // ═══════════════════════════════════════════════════════════════
  console.log('\n── 6. Job with standing shortage ──');

  const southernRailwaysPo = expectOk<{ id: string; number: string; customerId: string }>(
    await createCustomerPoTool.handler(ownerCtx, {
      customerName: 'Southern Railways – Coimbatore Division',
      number: 'SR-CPO-0031',
      poDate: daysFromNow(-14),
    }),
    'create customer PO: Southern Railways',
  );

  const job = expectOk<{ id: string; number: string; quantity: number }>(
    await createJobTool.handler(ownerCtx, {
      customerId: southernRailwaysPo.customerId,
      customerPoId: southernRailwaysPo.id,
      productDescription: 'Transformer Coil Assembly',
      quantity: 500,
      jobDate: daysFromNow(-2),
      dueDate: daysFromNow(20),
    }),
    'create job',
  );
  console.log(`  ${job.number} — Transformer Coil Assembly × ${job.quantity}`);

  await setJobBomTool.handler(ownerCtx, {
    jobId: job.id,
    lines: [
      { materialId: wire.id, qtyPerPiece: 0.05 },
      { materialId: ferrite.id, qtyPerPiece: 1 },
      { materialId: bobbin.id, qtyPerPiece: 1 },
    ],
  });
  console.log('  BOM set: wire 0.05kg/pc, ferrite 1pc/pc, bobbin 1pc/pc');

  const shortageAfterBom = expectOk<{ materialName: string; required: number; onHand: number; shortfall: number }[]>(
    await checkJobShortageTool.handler(ownerCtx, { jobId: job.id }),
    'check job shortage after BOM',
  );
  if (!shortageAfterBom.some((l) => l.shortfall > 0)) {
    throw new Error('Expected a real shortfall on at least one BOM line right after set_job_bom — seed data is miscalibrated.');
  }
  for (const line of shortageAfterBom) {
    console.log(`    ${line.materialName}: required ${line.required}, on hand ${line.onHand}, shortfall ${line.shortfall}`);
  }

  summary.customers = {
    ...(summary.customers as object),
    southernRailways: { id: southernRailwaysPo.customerId, name: 'Southern Railways – Coimbatore Division', customerPoNumber: southernRailwaysPo.number },
  };
  summary.job = { number: job.number, id: job.id, productDescription: 'Transformer Coil Assembly', quantity: job.quantity };

  // ═══════════════════════════════════════════════════════════════
  // 7. A second PO left PENDING_APPROVAL, for the manual tester to
  //    approve/reject themselves — linked to the job it would relieve.
  // ═══════════════════════════════════════════════════════════════
  console.log('\n── 7. Pending purchase order ──');

  const pendingPo = expectOk<{ id: string; number: string; status: string; totalValue: string }>(
    await createPurchaseOrderTool.handler(ownerCtx, {
      supplierName: 'Coimbatore Ferrite Supplies',
      lines: [{ materialId: ferrite.id, quantity: 3000, rate: 19, gstRate: 18 }],
      triggeredByJobId: job.id,
      expectedDate: daysFromNow(10),
    }),
    'create pending purchase order',
  );
  if (pendingPo.status !== 'PENDING_APPROVAL') {
    throw new Error(`Expected the Coimbatore Ferrite Supplies PO to require approval above the ₹50,000 threshold, got ${pendingPo.status}`);
  }
  console.log(`  ${pendingPo.number} — Coimbatore Ferrite Supplies — ₹${pendingPo.totalValue} — ${pendingPo.status} (left untouched)`);

  summary.suppliers = {
    ...(summary.suppliers as object),
    coimbatoreFerriteSupplies: { name: 'Coimbatore Ferrite Supplies' },
  };
  summary.pendingPurchaseOrder = { number: pendingPo.number, id: pendingPo.id, status: pendingPo.status, totalValue: pendingPo.totalValue };

  // ═══════════════════════════════════════════════════════════════
  // 8. Historical, already-approved stock count with a variance
  // ═══════════════════════════════════════════════════════════════
  console.log('\n── 8. Historical stock count ──');

  const countDate = daysFromNow(-21);
  const count = expectOk<{ id: string; number: string; lines: { id: string; materialId: string; systemQty: string }[] }>(
    await startStockCountTool.handler(ownerCtx, { countDate }),
    'start historical stock count',
  );
  console.log(`  ${count.number} — ${count.lines.length} line(s)`);

  const lineByMaterial = new Map(count.lines.map((l) => [l.materialId, l]));

  const wireLine = lineByMaterial.get(wire.id)!;
  await submitCountLineTool.handler(ownerCtx, {
    stockCountLineId: wireLine.id,
    countedQty: Number(wireLine.systemQty) - 1,
    reasonCode: 'SPILLAGE',
    notes: 'Small spillage during winding — floor sweep confirmed the shortfall.',
  });

  const ferriteLine = lineByMaterial.get(ferrite.id)!;
  await submitCountLineTool.handler(ownerCtx, {
    stockCountLineId: ferriteLine.id,
    countedQty: Number(ferriteLine.systemQty) - 5,
    // reasonCode deliberately omitted — submit_count_line auto-stamps
    // UNEXPLAINED for a non-zero difference with no reason given.
  });

  for (const material of [bobbin, varnish, copperScrap]) {
    const line = lineByMaterial.get(material.id)!;
    await submitCountLineTool.handler(ownerCtx, {
      stockCountLineId: line.id,
      countedQty: Number(line.systemQty),
    });
  }
  console.log('  all lines counted — wire short 1kg (SPILLAGE), ferrite short 5pcs (UNEXPLAINED)');

  const submitted = expectOk<{ count: { number: string }; materialsWithDifference: number }>(
    await submitStockCountTool.handler(ownerCtx, { stockCountId: count.id }),
    'submit stock count',
  );
  console.log(`  ${submitted.count.number} submitted — ${submitted.materialsWithDifference} material(s) with a difference`);

  const approved = expectOk<{ count: { number: string; status: string }; movements: { id: string }[] }>(
    await approveStockCountTool.handler(ownerCtx, { stockCountId: count.id }),
    'approve stock count',
  );
  console.log(`  ${approved.count.number} approved — ${approved.movements.length} COUNT_ADJUSTMENT movement(s) posted`);

  summary.historicalStockCount = {
    number: count.number,
    id: count.id,
    status: approved.count.status,
    materialsWithDifference: submitted.materialsWithDifference,
    unexplainedMaterial: 'Ferrite Core E-30',
  };

  // ═══════════════════════════════════════════════════════════════
  // 9/10. No further seeding — the reversible movement is noted above;
  //    issue/return/close, a fresh scrap cycle, a fresh count, and a
  //    reversal are left for the manual tester to do themselves.
  // ═══════════════════════════════════════════════════════════════

  // Final, authoritative numbers for the summary/testing doc — read AFTER
  // the count adjustment above, since that changed both materials' balances.
  const finalShortage = expectOk<{ materialName: string; required: number; onHand: number; shortfall: number }[]>(
    await checkJobShortageTool.handler(ownerCtx, { jobId: job.id }),
    'check job shortage (final)',
  );
  summary.job = { ...(summary.job as object), finalShortage };

  const finalBalances = expectOk<{ material: { name: string }; quantity: string; averageRate: string }[]>(
    await getMaterialBalanceTool.handler(ownerCtx, {
      materialIds: [wire.id, ferrite.id, bobbin.id, varnish.id, copperScrap.id],
    }),
    'get final material balances',
  );
  summary.finalMaterialBalances = finalBalances.map((b) => ({
    material: b.material.name,
    quantity: b.quantity,
    averageRate: b.averageRate,
  }));

  // ═══════════════════════════════════════════════════════════════
  // Summary output
  // ═══════════════════════════════════════════════════════════════
  const summaryPath = resolve(__dirname, 'seed-summary.json');
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');

  console.log('\n── Seed complete ──');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nWritten to ${summaryPath}`);
}

main()
  .catch((err) => {
    console.error('\nSeed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
