#!/usr/bin/env bash
# Manual Phase 1 verification script for tool-service (see repo's tool-service
# scaffolding prompt, "Verification before you consider this done"). Run this
# against a live `nx run tool-service:serve` (or `node dist/main.js`) instance,
# connected to the real Postgres instance.
#
# Usage: BASE_URL=http://localhost:5104 ./verify.sh

set -uo pipefail
BASE_URL="${BASE_URL:-http://localhost:5104}"
EMAIL="verify-$(date +%s)@example.com"
PASSWORD="password123"

pass=0
fail=0

check() {
  local desc="$1" expected_status="$2" actual_status="$3" body="$4"
  if [ "$actual_status" = "$expected_status" ]; then
    echo "PASS  $desc (HTTP $actual_status)"
    pass=$((pass + 1))
  else
    echo "FAIL  $desc — expected HTTP $expected_status, got $actual_status"
    echo "      body: $body"
    fail=$((fail + 1))
  fi
}

req() {
  # req METHOD PATH [BODY] [AUTH_HEADER]
  local method="$1" path="$2" data="${3:-}" auth="${4:-}"
  local args=(-s -w '\nHTTP_STATUS:%{http_code}' -X "$method" "$BASE_URL$path" -H 'Content-Type: application/json')
  [ -n "$auth" ] && args+=(-H "Authorization: $auth")
  [ -n "$data" ] && args+=(-d "$data")
  curl "${args[@]}"
}

echo "== tool-service Phase 1 verification against $BASE_URL (email: $EMAIL) =="

# 1. register fresh -> 200, token
r=$(req POST /tools/register/execute "{\"args\":{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"},\"confirmed\":true}")
status=$(echo "$r" | grep -o 'HTTP_STATUS:[0-9]*' | cut -d: -f2)
body=$(echo "$r" | sed '$d')
token=$(echo "$body" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).data.accessToken)}catch{console.log('')}})")
check "1. register fresh" 200 "$status" "$body"

# 2. register same email again -> 200, ok:false DUPLICATE_EMAIL
r=$(req POST /tools/register/execute "{\"args\":{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"},\"confirmed\":true}")
status=$(echo "$r" | grep -o 'HTTP_STATUS:[0-9]*' | cut -d: -f2)
body=$(echo "$r" | sed '$d')
check "2. register duplicate email (expect DUPLICATE_EMAIL in body)" 200 "$status" "$body"

# 3. login correct credentials -> 200, token
r=$(req POST /tools/login/execute "{\"args\":{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}}")
status=$(echo "$r" | grep -o 'HTTP_STATUS:[0-9]*' | cut -d: -f2)
body=$(echo "$r" | sed '$d')
check "3. login correct credentials" 200 "$status" "$body"

# 4. login wrong password -> 200, ok:false INVALID_CREDENTIALS
r=$(req POST /tools/login/execute "{\"args\":{\"email\":\"$EMAIL\",\"password\":\"wrong\"}}")
status=$(echo "$r" | grep -o 'HTTP_STATUS:[0-9]*' | cut -d: -f2)
body=$(echo "$r" | sed '$d')
check "4. login wrong password (expect INVALID_CREDENTIALS in body)" 200 "$status" "$body"

# 5. GET /tools -> lists register/login/whoami/list_rows, no auth
r=$(req GET /tools)
status=$(echo "$r" | grep -o 'HTTP_STATUS:[0-9]*' | cut -d: -f2)
body=$(echo "$r" | sed '$d')
check "5. GET /tools" 200 "$status" "$body"

# 6. whoami with valid token -> 200
r=$(req POST /tools/whoami/execute '{"args":{}}' "Bearer $token")
status=$(echo "$r" | grep -o 'HTTP_STATUS:[0-9]*' | cut -d: -f2)
body=$(echo "$r" | sed '$d')
check "6. whoami with valid token" 200 "$status" "$body"

# 7. whoami with no token -> 401
r=$(req POST /tools/whoami/execute '{"args":{}}')
status=$(echo "$r" | grep -o 'HTTP_STATUS:[0-9]*' | cut -d: -f2)
body=$(echo "$r" | sed '$d')
check "7. whoami with no token" 401 "$status" "$body"

# 8. list_rows on a real table -> 200
r=$(req POST /tools/list_rows/execute '{"args":{"table":"user","limit":5}}' "Bearer $token")
status=$(echo "$r" | grep -o 'HTTP_STATUS:[0-9]*' | cut -d: -f2)
body=$(echo "$r" | sed '$d')
check "8. list_rows real table" 200 "$status" "$body"

# 9. list_rows on a fake table -> 200, ok:false UNKNOWN_TABLE
r=$(req POST /tools/list_rows/execute '{"args":{"table":"not_a_real_table"}}' "Bearer $token")
status=$(echo "$r" | grep -o 'HTTP_STATUS:[0-9]*' | cut -d: -f2)
body=$(echo "$r" | sed '$d')
check "9. list_rows unknown table (expect UNKNOWN_TABLE in body)" 200 "$status" "$body"

# 10. register/login work with a garbage Authorization header
EMAIL2="verify-noauth-$(date +%s)@example.com"
r=$(req POST /tools/register/execute "{\"args\":{\"email\":\"$EMAIL2\",\"password\":\"$PASSWORD\"},\"confirmed\":true}" "Bearer garbage-not-a-jwt")
status=$(echo "$r" | grep -o 'HTTP_STATUS:[0-9]*' | cut -d: -f2)
body=$(echo "$r" | sed '$d')
check "10a. register with garbage Authorization header" 200 "$status" "$body"

r=$(req POST /tools/login/execute "{\"args\":{\"email\":\"$EMAIL2\",\"password\":\"$PASSWORD\"}}" "Bearer garbage-not-a-jwt")
status=$(echo "$r" | grep -o 'HTTP_STATUS:[0-9]*' | cut -d: -f2)
body=$(echo "$r" | sed '$d')
check "10b. login with garbage Authorization header" 200 "$status" "$body"

echo
echo "== $pass passed, $fail failed =="
exit $((fail > 0 ? 1 : 0))
