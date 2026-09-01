#!/usr/bin/env bash
set -uo pipefail
BASE_URL="${BASE_URL:-http://localhost:5104}"
EMAIL="verify-b-$(date +%s)@example.com"
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
  # jval <json> <node-expr-on-d>
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

echo "== Batch B verification against $BASE_URL (email: $EMAIL) =="

# setup: register + login, create a material for BOM lines
r=$(req POST /tools/register/execute "{\"args\":{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"},\"confirmed\":true}")
split "$r"
token=$(jval "$body" "j.data.accessToken")
AUTH="Bearer $token"
echo "token acquired: ${token:0:20}..."

matName1="Verify Copper Wire $(date +%s)"
r=$(req POST /tools/create_material/execute "{\"args\":{\"name\":\"$matName1\",\"uom\":\"KG\",\"stockType\":\"PER_JOB\"},\"confirmed\":true}" "$AUTH")
split "$r"
mat1=$(jval "$body" "j.data.id")

matName2="Verify Bobbin $(date +%s)"
r=$(req POST /tools/create_material/execute "{\"args\":{\"name\":\"$matName2\",\"uom\":\"NOS\",\"stockType\":\"PER_JOB\"},\"confirmed\":true}" "$AUTH")
split "$r"
mat2=$(jval "$body" "j.data.id")
echo "materials: $mat1 $mat2"

# 1. create_customer_po with brand-new customerName -> 200, new customer + PO, status OPEN
custName="Verify Customer $(date +%s)"
poNumber="PO-VERIFY-$(date +%s)"
r=$(req POST /tools/create_customer_po/execute "{\"args\":{\"customerName\":\"$custName\",\"number\":\"$poNumber\"},\"confirmed\":true}" "$AUTH")
split "$r"
po1Id=$(jval "$body" "j.data.id")
custId=$(jval "$body" "j.data.customerId")
poStatus=$(jval "$body" "j.data.status")
check "1. create_customer_po new customerName" 200 "$status" "$body"
[ "$poStatus" = "OPEN" ] && echo "      status OPEN: OK" || echo "      status OPEN: FAIL ($poStatus)"

# 2. create_customer_po again with same customerId+number -> 200, same PO id, no dup row
r=$(req POST /tools/create_customer_po/execute "{\"args\":{\"customerId\":\"$custId\",\"number\":\"$poNumber\"},\"confirmed\":true}" "$AUTH")
split "$r"
po2Id=$(jval "$body" "j.data.id")
check "2. create_customer_po repeat (HTTP)" 200 "$status" "$body"
if [ "$po1Id" = "$po2Id" ]; then echo "      same PO id: OK ($po1Id)"; else echo "      same PO id: FAIL ($po1Id vs $po2Id)"; fi

# 3. create_job with quantity 0 -> ok:false INVALID_QTY
r=$(req POST /tools/create_job/execute "{\"args\":{\"customerId\":\"$custId\",\"productDescription\":\"Verify widget\",\"quantity\":0,\"jobDate\":\"2026-09-01\"},\"confirmed\":true}" "$AUTH")
split "$r"
code=$(jval "$body" "j.code")
ok=$(jval "$body" "j.ok")
if [ "$status" = "200" ] && [ "$ok" = "false" ] && [ "$code" = "INVALID_QTY" ]; then
  echo "PASS  3. create_job quantity:0 -> INVALID_QTY"; pass=$((pass+1))
else
  echo "FAIL  3. create_job quantity:0 -> got status=$status ok=$ok code=$code body=$body"; fail=$((fail+1))
fi

# create a second customer + job to use as a mismatched parent for step 4
custName2="Verify Other Customer $(date +%s)"
r=$(req POST /tools/create_customer_po/execute "{\"args\":{\"customerName\":\"$custName2\",\"number\":\"PO-OTHER-$(date +%s)\"},\"confirmed\":true}" "$AUTH")
split "$r"
otherCustId=$(jval "$body" "j.data.customerId")

r=$(req POST /tools/create_job/execute "{\"args\":{\"customerId\":\"$otherCustId\",\"productDescription\":\"Other customer job\",\"quantity\":5,\"jobDate\":\"2026-09-01\"},\"confirmed\":true}" "$AUTH")
split "$r"
otherJobId=$(jval "$body" "j.data.id")

# 4. create_job SAMPLE with parentJobId belonging to a DIFFERENT customer -> PARENT_JOB_MISMATCH
r=$(req POST /tools/create_job/execute "{\"args\":{\"customerId\":\"$custId\",\"productDescription\":\"Sample of mismatched parent\",\"quantity\":1,\"jobDate\":\"2026-09-01\",\"type\":\"SAMPLE\",\"parentJobId\":\"$otherJobId\"},\"confirmed\":true}" "$AUTH")
split "$r"
code=$(jval "$body" "j.code")
ok=$(jval "$body" "j.ok")
if [ "$status" = "200" ] && [ "$ok" = "false" ] && [ "$code" = "PARENT_JOB_MISMATCH" ]; then
  echo "PASS  4. create_job SAMPLE mismatched parent -> PARENT_JOB_MISMATCH"; pass=$((pass+1))
else
  echo "FAIL  4. create_job SAMPLE mismatched parent -> got status=$status ok=$ok code=$code body=$body"; fail=$((fail+1))
fi

# 5. create_job normally -> 200, status OPEN, number matches JOB-<FY>-####
r=$(req POST /tools/create_job/execute "{\"args\":{\"customerId\":\"$custId\",\"customerPoId\":\"$po1Id\",\"productDescription\":\"Verify widget\",\"quantity\":10,\"jobDate\":\"2026-09-01\"},\"confirmed\":true}" "$AUTH")
split "$r"
jobId=$(jval "$body" "j.data.id")
jobNumber=$(jval "$body" "j.data.number")
jobStatus=$(jval "$body" "j.data.status")
check "5. create_job normal" 200 "$status" "$body"
if [[ "$jobNumber" =~ ^JOB-2627-[0-9]{4}$ ]] && [ "$jobStatus" = "OPEN" ]; then
  echo "      number/status OK: $jobNumber / $jobStatus"
else
  echo "      number/status FAIL: $jobNumber / $jobStatus (expected JOB-2627-#### / OPEN)"
fi

# 6. set_job_bom with two lines -> 200, requiredQty = qtyPerPiece * job.quantity for both
r=$(req POST /tools/set_job_bom/execute "{\"args\":{\"jobId\":\"$jobId\",\"lines\":[{\"materialId\":\"$mat1\",\"qtyPerPiece\":2.5},{\"materialId\":\"$mat2\",\"qtyPerPiece\":4}]},\"confirmed\":true}" "$AUTH")
split "$r"
check "6. set_job_bom two lines" 200 "$status" "$body"
req1=$(jval "$body" "j.data.find(l=>l.materialId==='$mat1').requiredQty")
req2=$(jval "$body" "j.data.find(l=>l.materialId==='$mat2').requiredQty")
if [ "$req1" = "25" ] && [ "$req2" = "40" ]; then
  echo "      requiredQty OK: mat1=$req1 (want 25) mat2=$req2 (want 40)"
else
  echo "      requiredQty FAIL: mat1=$req1 (want 25) mat2=$req2 (want 40)"
fi

# 7. set_job_bom again with changed qtyPerPiece on one line -> upsert in place, no dup row
r=$(req POST /tools/set_job_bom/execute "{\"args\":{\"jobId\":\"$jobId\",\"lines\":[{\"materialId\":\"$mat1\",\"qtyPerPiece\":3},{\"materialId\":\"$mat2\",\"qtyPerPiece\":4}]},\"confirmed\":true}" "$AUTH")
split "$r"
check "7. set_job_bom re-upsert" 200 "$status" "$body"
r=$(req POST /tools/get_job/execute "{\"args\":{\"jobId\":\"$jobId\"}}" "$AUTH")
split "$r"
bomCount=$(jval "$body" "j.data.bomLines.length")
req1b=$(jval "$body" "j.data.bomLines.find(l=>l.materialId==='$mat1').requiredQty")
if [ "$bomCount" = "2" ] && [ "$req1b" = "30" ]; then
  echo "      upsert-in-place OK: bomLines.length=$bomCount mat1 requiredQty=$req1b (want 30)"
else
  echo "      upsert-in-place FAIL: bomLines.length=$bomCount (want 2) mat1 requiredQty=$req1b (want 30)"
fi

# 8. manually close the job's status, retry set_job_bom -> JOB_NOT_OPEN, message references add_bom_line
node close_job_tmp.mjs "$jobId" 2>&1
r=$(req POST /tools/set_job_bom/execute "{\"args\":{\"jobId\":\"$jobId\",\"lines\":[{\"materialId\":\"$mat1\",\"qtyPerPiece\":1}]},\"confirmed\":true}" "$AUTH")
split "$r"
code=$(jval "$body" "j.code")
ok=$(jval "$body" "j.ok")
errMsg=$(jval "$body" "j.error")
if [ "$status" = "200" ] && [ "$ok" = "false" ] && [ "$code" = "JOB_NOT_OPEN" ] && [[ "$errMsg" == *"add_bom_line"* ]]; then
  echo "PASS  8. set_job_bom on non-OPEN job -> JOB_NOT_OPEN, mentions add_bom_line"; pass=$((pass+1))
else
  echo "FAIL  8. got status=$status ok=$ok code=$code err='$errMsg'"; fail=$((fail+1))
fi

# 9. check_job_shortage with zero stock -> shortfall == requiredQty for both lines
r=$(req POST /tools/check_job_shortage/execute "{\"args\":{\"jobId\":\"$jobId\"}}" "$AUTH")
split "$r"
check "9. check_job_shortage" 200 "$status" "$body"
sf1=$(jval "$body" "j.data.find(l=>l.materialId==='$mat1').shortfall")
sf2=$(jval "$body" "j.data.find(l=>l.materialId==='$mat2').shortfall")
if [ "$sf1" = "30" ] && [ "$sf2" = "40" ]; then
  echo "      shortfall OK: mat1=$sf1 (want 30) mat2=$sf2 (want 40)"
else
  echo "      shortfall FAIL: mat1=$sf1 (want 30) mat2=$sf2 (want 40)"
fi

# 10. get_job -> bomLines included, match steps 6/7 state
r=$(req POST /tools/get_job/execute "{\"args\":{\"jobId\":\"$jobId\"}}" "$AUTH")
split "$r"
check "10. get_job" 200 "$status" "$body"
bomCount2=$(jval "$body" "j.data.bomLines.length")
[ "$bomCount2" = "2" ] && echo "      bomLines present: OK" || echo "      bomLines present: FAIL ($bomCount2)"

# 11. get_job with nonexistent jobId -> JOB_NOT_FOUND
r=$(req POST /tools/get_job/execute "{\"args\":{\"jobId\":\"00000000-0000-0000-0000-000000000000\"}}" "$AUTH")
split "$r"
code=$(jval "$body" "j.code")
ok=$(jval "$body" "j.ok")
if [ "$status" = "200" ] && [ "$ok" = "false" ] && [ "$code" = "JOB_NOT_FOUND" ]; then
  echo "PASS  11. get_job nonexistent -> JOB_NOT_FOUND"; pass=$((pass+1))
else
  echo "FAIL  11. got status=$status ok=$ok code=$code body=$body"; fail=$((fail+1))
fi

# 12. get_job_bom_variance -> returns rows
r=$(req POST /tools/get_job_bom_variance/execute "{\"args\":{\"jobId\":\"$jobId\"}}" "$AUTH")
split "$r"
check "12. get_job_bom_variance" 200 "$status" "$body"
varCount=$(jval "$body" "j.data.length")
[ "$varCount" = "2" ] && echo "      rows returned: OK ($varCount)" || echo "      rows returned: FAIL ($varCount, body=$body)"

echo ""
echo "== $pass passed, $fail failed =="
