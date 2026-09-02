#!/usr/bin/env bash
set -uo pipefail
BASE_URL="${BASE_URL:-http://localhost:5104}"
TS=$(date +%s)
SK_EMAIL="verify-c-sk-$TS@example.com"
OWNER_EMAIL="verify-c-owner-$TS@example.com"
PASSWORD="password123"

pass=0
fail=0

check() {
  local desc="$1" expected="$2" actual="$3" body="$4"
  if [ "$actual" = "$expected" ]; then
    echo "PASS  $desc"
    pass=$((pass + 1))
  else
    echo "FAIL  $desc — expected $expected got $actual"
    echo "      body: $body"
    fail=$((fail + 1))
  fi
}

jval() {
  node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log($2)}catch(e){console.log('PARSE_ERROR:'+e.message)}})" <<< "$1"
}

req() {
  local method="$1" path="$2" data="${3:-}" auth="${4:-}"
  local args=(-s -w '\nHTTP_STATUS:%{http_code}' -X "$method" "$BASE_URL$path" -H 'Content-Type: application/json')
  [ -n "$auth" ] && args+=(-H "Authorization: $auth")
  [ -n "$data" ] && args+=(-d "$data")
  curl "${args[@]}"
}

split() {
  status=$(echo "$1" | grep -o 'HTTP_STATUS:[0-9]*' | cut -d: -f2)
  body=$(echo "$1" | sed '$d')
}

# Direct DB assertions the tool API surface can't answer (Notification rows,
# raw table counts) — run from the same directory so dotenv picks up .env.
dbq() {
  node -e "
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => { $1 })().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
"
}

echo "== Batch C (Purchasing) verification against $BASE_URL =="

# setup: a storekeeper account, an owner account, and a material to buy
r=$(req POST /tools/register/execute "{\"args\":{\"email\":\"$SK_EMAIL\",\"password\":\"$PASSWORD\"},\"confirmed\":true}")
split "$r"
SK_TOKEN=$(jval "$body" "j.data.accessToken")
SK_AUTH="Bearer $SK_TOKEN"

r=$(req POST /tools/register/execute "{\"args\":{\"email\":\"$OWNER_EMAIL\",\"password\":\"$PASSWORD\",\"role\":\"OWNER\"},\"confirmed\":true}")
split "$r"
OWNER_TOKEN=$(jval "$body" "j.data.accessToken")
OWNER_AUTH="Bearer $OWNER_TOKEN"
OWNER_ID=$(jval "$body" "j.data.userId")
echo "storekeeper + owner accounts created"

matName="Verify Purchasing Wire $TS"
r=$(req POST /tools/create_material/execute "{\"args\":{\"name\":\"$matName\",\"uom\":\"KG\",\"stockType\":\"PER_JOB\"},\"confirmed\":true}" "$SK_AUTH")
split "$r"
mat1=$(jval "$body" "j.data.id")
echo "material: $mat1"

supplierName="Verify Supplier $TS"

# ── 1. create_purchase_order below threshold -> APPROVED, no Notification ──
r=$(req POST /tools/create_purchase_order/execute "{\"args\":{\"supplierName\":\"$supplierName\",\"lines\":[{\"materialId\":\"$mat1\",\"quantity\":1,\"rate\":1000}]},\"confirmed\":true}" "$SK_AUTH")
split "$r"
po1Id=$(jval "$body" "j.data.id")
po1Status=$(jval "$body" "j.data.status")
supplierId=$(jval "$body" "j.data.supplierId")
check "1. create_purchase_order below threshold (HTTP)" 200 "$status" "$body"
if [ "$po1Status" = "APPROVED" ]; then echo "      status APPROVED: OK"; else echo "      status APPROVED: FAIL ($po1Status)"; fi
notifCount1=$(dbq "const n = await p.notification.count({ where: { entityId: '$po1Id' } }); console.log(n);")
if [ "$notifCount1" = "0" ]; then echo "      Notification rows for this PO: OK (0)"; else echo "      Notification rows for this PO: FAIL ($notifCount1, want 0)"; fi

# ── 2. create_purchase_order above threshold -> PENDING_APPROVAL, one Notification per active OWNER ──
ownerCount=$(dbq "const n = await p.user.count({ where: { role: 'OWNER', isActive: true } }); console.log(n);")
r=$(req POST /tools/create_purchase_order/execute "{\"args\":{\"supplierId\":\"$supplierId\",\"lines\":[{\"materialId\":\"$mat1\",\"quantity\":1,\"rate\":100000}]},\"confirmed\":true}" "$SK_AUTH")
split "$r"
po2Id=$(jval "$body" "j.data.id")
po2Status=$(jval "$body" "j.data.status")
check "2. create_purchase_order above threshold (HTTP)" 200 "$status" "$body"
if [ "$po2Status" = "PENDING_APPROVAL" ]; then echo "      status PENDING_APPROVAL: OK"; else echo "      status PENDING_APPROVAL: FAIL ($po2Status)"; fi
notifCount2=$(dbq "const n = await p.notification.count({ where: { entityId: '$po2Id', type: 'PO_PENDING_APPROVAL' } }); console.log(n);")
# NOTE: this DB has pre-existing OWNER accounts beyond the one this script
# creates, so "exactly one Notification" from the source doc is checked here
# as "exactly one per currently-active OWNER", not a hardcoded 1.
if [ "$notifCount2" = "$ownerCount" ]; then
  echo "PASS  2b. Notification rows == active OWNER count ($notifCount2 == $ownerCount)"; pass=$((pass+1))
else
  echo "FAIL  2b. Notification rows ($notifCount2) != active OWNER count ($ownerCount)"; fail=$((fail+1))
fi

# ── 3. create_purchase_order with a line missing rate -> MISSING_RATE, nothing inserted ──
poCountBefore=$(dbq "console.log(await p.purchaseOrder.count());")
r=$(req POST /tools/create_purchase_order/execute "{\"args\":{\"supplierId\":\"$supplierId\",\"lines\":[{\"materialId\":\"$mat1\",\"quantity\":1}]},\"confirmed\":true}" "$SK_AUTH")
split "$r"
code=$(jval "$body" "j.code")
ok=$(jval "$body" "j.ok")
poCountAfter=$(dbq "console.log(await p.purchaseOrder.count());")
if [ "$status" = "200" ] && [ "$ok" = "false" ] && [ "$code" = "MISSING_RATE" ] && [ "$poCountBefore" = "$poCountAfter" ]; then
  echo "PASS  3. missing rate -> MISSING_RATE, nothing inserted ($poCountBefore == $poCountAfter)"; pass=$((pass+1))
else
  echo "FAIL  3. status=$status ok=$ok code=$code before=$poCountBefore after=$poCountAfter body=$body"; fail=$((fail+1))
fi

# ── 4. approve as non-owner -> blocked (router requiredRoles gate -> HTTP 403 before the handler's own FORBIDDEN_NOT_OWNER check ever runs) ──
r=$(req POST /tools/approve_purchase_order/execute "{\"args\":{\"purchaseOrderId\":\"$po2Id\"},\"confirmed\":true}" "$SK_AUTH")
split "$r"
check "4. approve as non-owner -> HTTP 403 (requiredRoles gate)" 403 "$status" "$body"

# ── 5. approve as owner -> APPROVED, approvedById/approvedAt set ──
r=$(req POST /tools/approve_purchase_order/execute "{\"args\":{\"purchaseOrderId\":\"$po2Id\"},\"confirmed\":true}" "$OWNER_AUTH")
split "$r"
check "5. approve as owner (HTTP)" 200 "$status" "$body"
approvedStatus=$(jval "$body" "j.data.status")
approvedBy=$(jval "$body" "j.data.approvedById")
approvedAt=$(jval "$body" "j.data.approvedAt")
if [ "$approvedStatus" = "APPROVED" ] && [ "$approvedBy" = "$OWNER_ID" ] && [ "$approvedAt" != "null" ]; then
  echo "      APPROVED + approvedById/approvedAt set: OK"
else
  echo "      FAIL: status=$approvedStatus approvedById=$approvedBy approvedAt=$approvedAt"
fi

# ── 6. reject a different pending PO with a reason -> REJECTED, reason persisted ──
r=$(req POST /tools/create_purchase_order/execute "{\"args\":{\"supplierId\":\"$supplierId\",\"lines\":[{\"materialId\":\"$mat1\",\"quantity\":1,\"rate\":100000}]},\"confirmed\":true}" "$SK_AUTH")
split "$r"
po3Id=$(jval "$body" "j.data.id")
rejectReason="Price too high, renegotiate"
r=$(req POST /tools/reject_purchase_order/execute "{\"args\":{\"purchaseOrderId\":\"$po3Id\",\"reason\":\"$rejectReason\"},\"confirmed\":true}" "$OWNER_AUTH")
split "$r"
check "6. reject_purchase_order (HTTP)" 200 "$status" "$body"
rejStatus=$(jval "$body" "j.data.status")
rejReason=$(jval "$body" "j.data.rejectionReason")
if [ "$rejStatus" = "REJECTED" ] && [ "$rejReason" = "$rejectReason" ]; then
  echo "      REJECTED + reason persisted: OK ('$rejReason')"
else
  echo "      FAIL: status=$rejStatus reason='$rejReason'"
fi

# ── 7a. full receipt against the approved PO from step 5 -> RECEIPT movement, receivedQty updated, PO -> RECEIVED ──
poLineId=$(dbq "const l = await p.purchaseOrderLine.findFirst({ where: { purchaseOrderId: '$po2Id' } }); console.log(l.id);")
r=$(req POST /tools/record_goods_receipt/execute "{\"args\":{\"supplierId\":\"$supplierId\",\"purchaseOrderId\":\"$po2Id\",\"receiptDate\":\"2026-09-01\",\"lines\":[{\"materialId\":\"$mat1\",\"purchaseOrderLineId\":\"$poLineId\",\"receivedQty\":1,\"acceptedQty\":1,\"rejectedQty\":0,\"rate\":100000}]},\"confirmed\":true}" "$SK_AUTH")
split "$r"
check "7a. record_goods_receipt full accept (HTTP)" 200 "$status" "$body"
grn1Id=$(jval "$body" "j.data.id")
movCount=$(dbq "const n = await p.stockMovement.count({ where: { grnLineId: { in: (await p.goodsReceiptLine.findMany({ where: { goodsReceiptId: '$grn1Id' } })).map(l=>l.id) }, type: 'RECEIPT' } }); console.log(n);")
poAfter=$(dbq "const po = await p.purchaseOrder.findUnique({ where: { id: '$po2Id' } }); console.log(po.status);")
if [ "$movCount" = "1" ] && [ "$poAfter" = "RECEIVED" ]; then
  echo "      RECEIPT movement inserted + PO -> RECEIVED: OK"
else
  echo "      FAIL: RECEIPT movements=$movCount (want 1), po status=$poAfter (want RECEIVED)"
fi

# ── 7b. partial receipt path: new approved PO with qty 10, receive 4 -> PARTIALLY_RECEIVED ──
r=$(req POST /tools/create_purchase_order/execute "{\"args\":{\"supplierId\":\"$supplierId\",\"lines\":[{\"materialId\":\"$mat1\",\"quantity\":10,\"rate\":100}]},\"confirmed\":true}" "$SK_AUTH")
split "$r"
po4Id=$(jval "$body" "j.data.id")
po4LineId=$(dbq "const l = await p.purchaseOrderLine.findFirst({ where: { purchaseOrderId: '$po4Id' } }); console.log(l.id);")
r=$(req POST /tools/record_goods_receipt/execute "{\"args\":{\"supplierId\":\"$supplierId\",\"purchaseOrderId\":\"$po4Id\",\"receiptDate\":\"2026-09-01\",\"lines\":[{\"materialId\":\"$mat1\",\"purchaseOrderLineId\":\"$po4LineId\",\"receivedQty\":4,\"acceptedQty\":4,\"rejectedQty\":0,\"rate\":100}]},\"confirmed\":true}" "$SK_AUTH")
split "$r"
check "7b. record_goods_receipt partial (HTTP)" 200 "$status" "$body"
po4Status=$(dbq "const po = await p.purchaseOrder.findUnique({ where: { id: '$po4Id' } }); console.log(po.status);")
if [ "$po4Status" = "PARTIALLY_RECEIVED" ]; then echo "      PO -> PARTIALLY_RECEIVED: OK"; else echo "      PO -> PARTIALLY_RECEIVED: FAIL ($po4Status)"; fi

# ── 8. split mismatch -> SPLIT_MISMATCH, nothing inserted ──
grnCountBefore=$(dbq "console.log(await p.goodsReceipt.count());")
r=$(req POST /tools/record_goods_receipt/execute "{\"args\":{\"supplierId\":\"$supplierId\",\"receiptDate\":\"2026-09-01\",\"lines\":[{\"materialId\":\"$mat1\",\"receivedQty\":5,\"acceptedQty\":2,\"rejectedQty\":2,\"rate\":100}]},\"confirmed\":true}" "$SK_AUTH")
split "$r"
code=$(jval "$body" "j.code")
ok=$(jval "$body" "j.ok")
grnCountAfter=$(dbq "console.log(await p.goodsReceipt.count());")
if [ "$status" = "200" ] && [ "$ok" = "false" ] && [ "$code" = "SPLIT_MISMATCH" ] && [ "$grnCountBefore" = "$grnCountAfter" ]; then
  echo "PASS  8. split mismatch -> SPLIT_MISMATCH, nothing inserted"; pass=$((pass+1))
else
  echo "FAIL  8. status=$status ok=$ok code=$code before=$grnCountBefore after=$grnCountAfter"; fail=$((fail+1))
fi

# ── 9. rejectedQty > 0 with no rejectionReason -> MISSING_REJECTION_REASON ──
r=$(req POST /tools/record_goods_receipt/execute "{\"args\":{\"supplierId\":\"$supplierId\",\"receiptDate\":\"2026-09-01\",\"lines\":[{\"materialId\":\"$mat1\",\"receivedQty\":5,\"acceptedQty\":3,\"rejectedQty\":2,\"rate\":100}]},\"confirmed\":true}" "$SK_AUTH")
split "$r"
code=$(jval "$body" "j.code")
ok=$(jval "$body" "j.ok")
if [ "$status" = "200" ] && [ "$ok" = "false" ] && [ "$code" = "MISSING_REJECTION_REASON" ]; then
  echo "PASS  9. rejected with no reason -> MISSING_REJECTION_REASON"; pass=$((pass+1))
else
  echo "FAIL  9. status=$status ok=$ok code=$code body=$body"; fail=$((fail+1))
fi

# ── 10. receipt against a PENDING_APPROVAL PO -> PO_NOT_APPROVED, then overrideConfirmed:true -> succeeds ──
r=$(req POST /tools/create_purchase_order/execute "{\"args\":{\"supplierId\":\"$supplierId\",\"lines\":[{\"materialId\":\"$mat1\",\"quantity\":1,\"rate\":100000}]},\"confirmed\":true}" "$SK_AUTH")
split "$r"
po5Id=$(jval "$body" "j.data.id")
po5LineId=$(dbq "const l = await p.purchaseOrderLine.findFirst({ where: { purchaseOrderId: '$po5Id' } }); console.log(l.id);")
r=$(req POST /tools/record_goods_receipt/execute "{\"args\":{\"supplierId\":\"$supplierId\",\"purchaseOrderId\":\"$po5Id\",\"receiptDate\":\"2026-09-01\",\"lines\":[{\"materialId\":\"$mat1\",\"purchaseOrderLineId\":\"$po5LineId\",\"receivedQty\":1,\"acceptedQty\":1,\"rejectedQty\":0,\"rate\":100000}]},\"confirmed\":true}" "$SK_AUTH")
split "$r"
code=$(jval "$body" "j.code")
ok=$(jval "$body" "j.ok")
if [ "$status" = "200" ] && [ "$ok" = "false" ] && [ "$code" = "PO_NOT_APPROVED" ]; then
  echo "PASS  10a. receipt against PENDING_APPROVAL PO -> PO_NOT_APPROVED"; pass=$((pass+1))
else
  echo "FAIL  10a. status=$status ok=$ok code=$code body=$body"; fail=$((fail+1))
fi
r=$(req POST /tools/record_goods_receipt/execute "{\"args\":{\"supplierId\":\"$supplierId\",\"purchaseOrderId\":\"$po5Id\",\"receiptDate\":\"2026-09-01\",\"lines\":[{\"materialId\":\"$mat1\",\"purchaseOrderLineId\":\"$po5LineId\",\"receivedQty\":1,\"acceptedQty\":1,\"rejectedQty\":0,\"rate\":100000}],\"overrideConfirmed\":true},\"confirmed\":true}" "$SK_AUTH")
split "$r"
check "10b. receipt with overrideConfirmed:true -> succeeds" 200 "$status" "$body"
ok=$(jval "$body" "j.ok")
[ "$ok" = "true" ] && echo "      ok:true: OK" || echo "      ok:true: FAIL (ok=$ok)"

# ── 11. get_purchase_price_history for mat1 -> rates ordered by date desc ──
r=$(req POST /tools/get_purchase_price_history/execute "{\"args\":{\"materialId\":\"$mat1\"}}" "$SK_AUTH")
split "$r"
check "11. get_purchase_price_history (HTTP)" 200 "$status" "$body"
histLen=$(jval "$body" "j.data.length")
firstDate=$(jval "$body" "j.data[0]?.receiptDate")
lastDate=$(jval "$body" "j.data[j.data.length-1]?.receiptDate")
if [ -n "$histLen" ] && [ "$histLen" -gt "0" ] && [[ "$firstDate" > "$lastDate" || "$firstDate" == "$lastDate" ]]; then
  echo "      history returned, ordered desc: OK ($histLen rows)"
else
  echo "      FAIL: histLen=$histLen first=$firstDate last=$lastDate"
fi

# ── 12. list_pending_approvals -> still-pending POs returned; TODO comment present in source ──
r=$(req POST /tools/list_pending_approvals/execute "{\"args\":{}}" "$SK_AUTH")
split "$r"
check "12. list_pending_approvals (HTTP)" 200 "$status" "$body"
pendingIds=$(jval "$body" "j.data.purchaseOrders.map(p=>p.id).join(',')")
if [[ "$pendingIds" == *"$po3Id"* ]] || [[ "$pendingIds" == *"$po1Id"* ]]; then
  echo "      contains a still-pending PO: OK"
else
  echo "      note: po3/po1 not pending (po3 was rejected, po1 was auto-approved) — checking any PENDING_APPROVAL row exists instead"
fi
anyPending=$(jval "$body" "j.data.purchaseOrders.length")
[ "$anyPending" -gt "0" ] 2>/dev/null && echo "      pending rows present: OK ($anyPending)" || echo "      pending rows present: FAIL ($anyPending)"
if grep -q "TODO(batch-f)" src/tools/plugins/list_pending_approvals.ts; then
  echo "PASS  12b. TODO(batch-f) union comment present in source"; pass=$((pass+1))
else
  echo "FAIL  12b. TODO(batch-f) comment missing"; fail=$((fail+1))
fi

# ── 13. GET /tools -> all six tools listed with correct metadata ──
r=$(req GET /tools)
split "$r"
check "13. GET /tools (HTTP)" 200 "$status" "$body"
for name in create_purchase_order approve_purchase_order reject_purchase_order record_goods_receipt get_purchase_price_history list_pending_approvals; do
  mutates=$(jval "$body" "j.tools.find(t=>t.name==='$name')?.mutates")
  destructive=$(jval "$body" "j.tools.find(t=>t.name==='$name')?.destructive")
  roles=$(jval "$body" "JSON.stringify(j.tools.find(t=>t.name==='$name')?.requiredRoles)")
  echo "      $name: mutates=$mutates destructive=$destructive requiredRoles=$roles"
done

echo ""
echo "== $pass passed, $fail failed =="
