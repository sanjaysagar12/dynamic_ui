# Opening count — handover

**Apply** from the repo root, on `main` at `3c54608` or later:

    git apply opening-count.patch

## Then

**Fresh / test databases** — nothing extra. The guards are in `inventory_guards.sql`, which the
test setup already applies after `migrate deploy`.

**The live Supabase database** — `inventory_guards.sql` can't be re-run there (its CREATE TRIGGER
statements would fail), so apply only the changes:

    npx prisma migrate deploy                 # adds unitRate / sourceInvoiceNo / sourceInvoiceDate
    npx prisma generate
    psql "$DIRECT_URL" -f prisma/opening_count_live.sql   # or paste into the SQL editor

`opening_count_live.sql` is safe to run more than once. If step 1 inside it fails, the database
already has OPENING rows that didn't come from a count — test data; reset the database instead.

Then run the tests: `npx jest test/tools test/db`.

## What was verified

- Patch applies cleanly to a fresh clone of `main` at `3c54608`.
- tool-service (all src, all tests incl. `test/db`) and db-agent-service type-check under the
  repo's strict settings.
- **SQL run for real** on PostgreSQL 16:
  - all 8 migrations in `prisma/migrations` + the updated `inventory_guards.sql` on an empty
    database, then every opening-count rule exercised (`opening_count_db_check.sql`, included) —
    all pass;
  - a database built with the **old** guard file (like live), upgraded with
    `opening_count_live.sql` run twice, then the same checks — all pass.
- Jest tests were type-checked, not executed (Testcontainers needs Docker). Please run them.

## The business rules this implements

Agreed with the owner:
- Opening count = go-live, **once**. Every material with stock gets a quantity **and a rate from
  its last purchase invoice**. **Invoice number is optional.** No ₹0 rates.
- Can be filled over several days. **No reason codes** on the opening count.
- Approval puts stock in as **OPENING** movements at those rates (not COUNT_ADJUSTMENT at the
  zero average — that valued all opening stock at ₹0 and skewed every later job cost).
- **Never appears in the leak report.**

## What changed (17 files)

**Database** (`inventory_guards.sql`, `opening_count_live.sql`, migration `20260925000000_opening_count_rates`)
- `StockCountLine.unitRate`, `sourceInvoiceNo`, `sourceInvoiceDate`.
- `chk_count_rate_positive` — rate is null or > 0.
- `chk_opening_has_count` + `guard_count_adjustment` now also guards OPENING: OPENING only from an
  approved opening count; COUNT_ADJUSTMENT never from an opening count. **Closes a backdoor** —
  before this, an OPENING row could add stock at any rate with no count and no approval.
- New `trg_guard_count_submission`: no count leaves DRAFT with an uncounted line; an opening count
  can't with a missing rate; **only one opening count can ever be APPROVED**.
- `v_material_leak` excludes opening counts. Also fixed: a matching line with no reason was being
  counted as "unexplained".

**Tools**
- `start_stock_count` — opening: refuses if one is in progress (`OPENING_IN_PROGRESS`), already
  done (`OPENING_ALREADY_DONE`), or if any stock movement already exists (`OPENING_NOT_FIRST` —
  its lines are frozen at zero, so earlier stock would be counted twice).
- `submit_count_line` — rate/invoice fields (opening only; `RATE_NOT_ALLOWED` on normal counts);
  never a reason on the opening count; quantity optional so a rate can be added later on its own;
  reason is a dropdown with "Don't know" first; **works on sent-back counts**.
- `submit_stock_count` — resends sent-back counts; names exactly which materials are missing a
  quantity or rate; opening count tells the owner the **total value**, not "differences".
- `approve_stock_count` — opening branch posts OPENING at `unitRate` (zero-stock lines post
  nothing); refuses if stock was recorded after the count started.
- `reject_stock_count` — **bug fix:** "recount needed" now goes to the storekeeper (and whoever
  started the count), not to the owner who just sent it back.
- **New `list_count_lines`** — the count with material names. Now the count-line dropdown: it
  previously listed raw ids.

**Prompts** — tool descriptions, business prompt, screen-agent rules and your post-write hook
messages updated: invoice optional, never suggest a rate, no talk of "differences" on the opening
count.

**Tests**
- New `test/tools/opening-count.test.ts` — the whole go-live flow in order, plus DB-level guards.
- `test/db/1.3-running-balance.test.ts` — one bare `OPENING` insert changed to `RECEIPT` (the
  test is about running balances; bare OPENING rows are now correctly forbidden).

## Decisions made — change if you disagree

- **Sent-back counts are fixed in place** (same count), not recounted from scratch.
- **The opening count must be the first stock activity.** No receipts or issues until it's
  approved. Go-live day/weekend should be planned around that.
- **A zero-quantity line needs no rate.**
