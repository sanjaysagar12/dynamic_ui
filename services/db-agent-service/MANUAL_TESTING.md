# Manual `/db-chat` testing guide

This doc assumes a fresh `npm run db:reset:soft` was just run in
`services/tool-service` (from a working local `DATABASE_URL` — see that
project's README/`prisma/reset-soft.ts` for the local-database safety
guard). Every job/PO/material identifier below was read straight out of the
`seed-summary.json` a real run produced — **not** hand-typed placeholders.

Doc numbers (`MAT-####`, `JOB-<FY>-####`, `PO-<FY>-####`, `GRN-<FY>-####`,
`CNT-<FY>-####`) are reproducible across resets, because `db:reset:soft`
truncates `NumberSeries` along with everything else. Raw UUIDs (material
ids, movement ids, party ids) are **not** reproducible — they're fresh
random values every run — so nothing below references one directly; where a
tool genuinely needs a raw id with no lookup-by-number path (`reverse_movement`),
the walkthrough finds it live via `get_movement_history` instead of
hardcoding it.

**If `seed.ts` changes, regenerate this doc** (or at least its identifier
references) against a fresh `seed-summary.json` — don't hand-edit numbers
here without rerunning the seed.

**How confirmation actually works today — read this before the tool
sections below.** Confirmed live against a running `/db-chat`: the moment
your request's intent points at a mutating tool, the agent calls it
immediately with whatever arguments it can infer (zero is fine) — it never
asks a clarifying question in chat text first. That call never writes
anything by itself; it hands back a **review form**, pre-filled with the
inferred values, rendered inline in the chat thread. You fill in or correct
whatever's missing, click **Review**, check the summary screen, then click
the submit button (its label is named per tool below, e.g. "Create
material"). *That click* — not a "yes, go ahead" reply in the chat box — is
the actual write confirmation; there is no other conversational confirm
step. If the tool rejects the submission (a duplicate name, a wrong-status
error, a role refusal), the same form reopens with the error shown above
it and your values intact, so every "Confirm with" line below describes
this same review-form step rather than a chat reply, and every "Expect"
line assumes you got there via the form's submit button.

## Seeded state, as of this run

| | |
|---|---|
| Owner login | `owner@vijaya.test` / `VijayaOwner#2026` |
| Storekeeper login | `storekeeper@vijaya.test` / `VijayaStore#2026` |
| Materials | `MAT-0001` 22 SWG Copper Wire (KG, STANDING, min 50) · `MAT-0002` Ferrite Core E-30 (NOS, STANDING, min 500) · `MAT-0003` Bobbin Type B (NOS, PER_JOB) · `MAT-0004` Insulation Varnish (LTR, STANDING, min 20) · `MAT-0005` Copper Scrap (KG, scrap, PER_JOB) |
| Suppliers | Chennai Wire Traders · Coimbatore Ferrite Supplies |
| Customers | Southern Railways – Coimbatore Division (`SR-CPO-0031`) · BrightLED Solutions (`BLS-PO-0118`) · SunPower Solar Pvt Ltd (`SPS-PO-0042`) |
| Opening PO | `PO-2627-0001` — Chennai Wire Traders — ₹26,432 — APPROVED (below the ₹50,000 threshold) |
| Opening GRN | `GRN-2627-0001` — fully accepted: 20kg wire @ ₹850, 300pcs ferrite @ ₹18 |
| Job | `JOB-2627-0001` — Transformer Coil Assembly × 500, for Southern Railways, BOM already set (wire 0.05kg/pc, ferrite 1pc/pc, bobbin 1pc/pc) |
| Job shortage (as seeded) | wire short 6kg, ferrite short 205pcs, bobbin short 500pcs |
| Pending PO | `PO-2627-0002` — Coimbatore Ferrite Supplies — 3,000pcs Ferrite Core E-30 — ₹67,260 — PENDING_APPROVAL, triggered by `JOB-2627-0001` |
| Historical count | `CNT-2627-0001` — APPROVED — wire −1kg (SPILLAGE), ferrite −5pcs (UNEXPLAINED) |
| Current balances | wire 19kg @ ₹850 · ferrite 295pcs @ ₹18 · bobbin 0 · varnish 0 · scrap 0 |

A note on `get_leak_report` and `list_reorder_alerts`: `prisma/inventory_guards.sql`
defines the underlying views (`v_material_leak`, `v_reorder_alerts`) and
step 8's historical count exists partly to give `v_material_leak` a real
UNEXPLAINED row to show — but **neither view is wrapped by a tool yet**.
They aren't in `tools.enabled.json`, so they have no section below; there's
currently no way to reach either through `/db-chat` at all. This is worth
flagging as follow-up tool work, not a gap in this doc.

---

## Identity

### `register`
- What it does: creates a new user account and returns an access token.
- Log in as: nobody — `requiresAuth: false`, this is how you get logged in.
- Try this prompt: "I need an account — sathish@vijaya.test, password Sathish#2026, I'm a storekeeper."
- Confirm with: a **Create Account** form opens, showing only `email` and `password` fields. Review, then click "Create account".
- Expect: a new STOREKEEPER account.
- **⚠ Real finding, verified live — please read before testing this one.** `register`'s `FormSpec` (`register.ts`) only declares `email`/`password` fields — `role` is never rendered, so a human reviewing the form has no way to see or edit it. But `role` *is* part of the tool's input schema, so if your prompt gives the model a reason to infer one (try: "Register a new **OWNER** account for sathish@vijaya.test, password Sathish#2026 — he needs full owner access"), the model puts `role: "OWNER"` in the `prefill` it hands back — and `DynamicForm.tsx`'s submit handler sends the *entire* `values` object as args, not just the declared fields, so that invisible `role` value rides along into the real `create_material`-style write untouched. Confirmed against the live database: this silently creates a real OWNER account with no on-screen indication of the elevated role at any point — nothing in the form, the review step, or the success message ("✓ Create Account completed.") ever shows "OWNER". Compare this against the *visible-name* prompt above (no role mentioned) — that one correctly defaults to STOREKEEPER. This is worth reporting as a real gap (`DynamicForm` should only submit fields the form actually declared, or `register`'s form should render `role` when it's present) rather than something to just note and move past. **Negative case:** try registering `owner@vijaya.test` again — expect `DUPLICATE_EMAIL`, not a second account.

### `login`
- What it does: authenticates with email + password, returns an access token.
- Log in as: nobody.
- Try this prompt: "Log me in as owner@vijaya.test, password VijayaOwner#2026."
- Confirm with: n/a — `mutates: false`, no write happens.
- Expect: `{ userId, email, role: OWNER }` back. **Negative case:** "log me in as owner@vijaya.test, password wrongpassword" — expect `INVALID_CREDENTIALS` (same message whether the email is wrong or the password is — the agent shouldn't reveal which).

### `whoami`
- What it does: returns the caller's own identity as resolved from their token.
- Log in as: either — OWNER or STOREKEEPER.
- Try this prompt: "Who am I logged in as?"
- Confirm with: n/a — read-only.
- Expect: your own `{ userId, email, role }`. No named failure precondition to exercise here — any authenticated caller succeeds.

---

## Material Master

### `list_rows`
- What it does: generic `findMany` over any table, by name — unscoped, the one genuinely table-agnostic tool in the catalog.
- Log in as: either.
- Try this prompt: "List every party we've got flagged as a supplier."
- Confirm with: n/a — read-only.
- Expect: Chennai Wire Traders and Coimbatore Ferrite Supplies. **Negative case:** "list rows from the table `secret_admin_notes`" — expect `UNKNOWN_TABLE`, not a raw Prisma error.

### `search_materials`
- What it does: case-insensitive substring search over material names.
- Log in as: either.
- Try this prompt: "Search materials for 'ferrite'."
- Confirm with: n/a — read-only.
- Expect: Ferrite Core E-30 (MAT-0002). No named failure precondition — searching for something with zero matches just returns an empty list, not an error.

### `create_material` (worked example)
- What it does: registers a new material in the master list.
- Log in as: OWNER — or STOREKEEPER, this tool has no `requiredRoles`; note that explicitly rather than assuming.
- Try this prompt: "We're starting to stock a new insulation tape, 3M Scotch 33+, sold in 20m rolls. Standing stock, keep at least 10 rolls on hand."
- Confirm with: a **New Material** form opens, pre-filled from your message (verified live: name "3M Scotch 33+ Insulation Tape", uom ROLL, stockType STANDING, minimumLevel 10). Review, then click "Create material".
- Expect: a new `MAT-0006` material created; ask a follow-up ("what's the material code you just gave it?") and confirm the agent reports it back correctly. **Negative case:** try creating "22 SWG Copper Wire" again (the exact seeded name) — confirmed live: the form reopens with "Couldn't complete that: A material with a very similar name already exists (existing: 22 SWG Copper Wire)" shown above it, and nothing new is created — rather than creating a second one.

### `update_material`
- What it does: updates name/minimumLevel/hsnCode/gstRate — `uom`/`stockType` are immutable.
- Log in as: either.
- Try this prompt: "Bump the minimum level on 22 SWG Copper Wire to 60kg."
- Confirm with: an **Update Material** form opens with the material and `minimumLevel: 60` pre-filled. Review, then click "Save changes".
- Expect: `MAT-0001`'s `minimumLevel` becomes 60. **Negative case:** "Actually, change 22 SWG Copper Wire's unit of measure to metres" — expect `IMMUTABLE_FIELD`, since `uom` can't be changed after creation.

### `deactivate_material`
- What it does: deactivates a material (never a real delete) — requires zero stock on hand.
- Log in as: either.
- Try this prompt: "We're never going to need Insulation Varnish again, deactivate it. Reason: switched to a pre-varnished wire supplier."
- Confirm with: a **Deactivate Material** form opens with the material and reason pre-filled. Review, then click "Deactivate".
- Expect: Insulation Varnish (0 on hand, seeded but never received) deactivates cleanly. **Negative case:** "Deactivate 22 SWG Copper Wire, reason: discontinuing" — expect `MATERIAL_HAS_STOCK` (19kg still on hand) rather than a silent success.

### `get_material_balance`
- What it does: current stock balance for one or more materials.
- Log in as: either.
- Try this prompt: "What's our current balance on 22 SWG Copper Wire and Ferrite Core E-30?"
- Confirm with: n/a — read-only.
- Expect: wire 19kg @ ₹850, ferrite 295pcs @ ₹18 (before any manual-testing writes below change them).

---

## Jobs & BOM

### `create_customer_po`
- What it does: creates (or looks up) the umbrella customer PO a job release is raised against.
- Log in as: either.
- Try this prompt: "Southern Railways just sent another PO, number SR-CPO-0032, dated today."
- Confirm with: a **New Customer PO** form opens with customer/number/date pre-filled. Review, then click "Create customer PO".
- Expect: a second, independent `CustomerPo` for Southern Railways (distinct from the seeded `SR-CPO-0031`). **Negative case:** call it again with the exact same customer + number (`SR-CPO-0031`) and confirm the agent reports the *existing* PO back rather than treating the repeat as a failure — this tool is a lookup-or-create, not a duplicate-rejection, by design.

### `create_job`
- What it does: creates a new job (one release against a customer PO), auto-numbered `JOB-<FY>-####`.
- Log in as: either.
- Try this prompt: "New job for Southern Railways against SR-CPO-0031: Junction Box Assembly, 200 units, dated today, due in three weeks."
- Confirm with: a **New Job** form opens pre-filled. Review, then click "Create job".
- Expect: `JOB-2627-0002` created, OPEN, no BOM yet. **Negative case:** "New job for Southern Railways, product 'Test Run', quantity 0" — expect `INVALID_QTY`.

### `set_job_bom` (highest-stakes confirm-before-write tool)
- What it does: sets (replaces) a job's full BOM — `requiredQty` computed as `qtyPerPiece × job.quantity`.
- Log in as: either.
- Try this prompt: "For the Junction Box job, BOM is 0.02kg copper wire per piece and 0.1L insulation varnish per piece."
- Confirm with: a **Set Job BOM** form opens, with the tool's own `confirmationCopy` banner shown above the fields ("This replaces the full bill of materials for the job. Double-check every per-piece quantity — a wrong figure multiplies across the whole run."). Review, then click "Save BOM".
- **⚠ Worth checking, not just assuming.** The tool's own description says the orchestrator "MUST restate the full computed `requiredQty` for every line" before writing — but the form's fields (`set_job_bom.ts`'s `FormSpec`) only expose `qtyPerPiece` per line; `requiredQty` is computed server-side and never appears anywhere in the review step, only in the result afterward. So the one number this tool calls its own highest-stakes figure (4kg wire, 20L varnish, for 200 units) is never actually shown to you before you click "Save BOM" — only the raw per-piece inputs are. Flag this as a real gap between the tool's documented expectation and the current form UI, and cross-check the resulting `requiredQty` with `get_job` afterward rather than trusting the form screen to have shown it.
- Expect: the BOM lines are set with `requiredQty` correctly computed, even though you never saw that number during confirmation. **Negative case:** covered in the Full Job Lifecycle walkthrough below (`JOB_NOT_OPEN` — a job already past OPEN can't have its BOM replaced this way).

### `check_job_shortage`
- What it does: per-material shortfall (`requiredQty − on-hand`, floored at 0) for a job's current BOM.
- Log in as: either.
- Try this prompt: "Are we short on anything for JOB-2627-0001?"
- Confirm with: n/a — read-only.
- Expect: wire short ~6kg, ferrite short ~205pcs, bobbin short 500pcs (exact numbers per the table above, before you resolve the shortage in the lifecycle walkthrough). No named failure precondition — a job with no BOM just returns an empty list.

### `get_job`
- What it does: a job's full detail — BOM lines plus the running material-cost summary from the ledger.
- Log in as: either.
- Try this prompt: "Give me the full detail on JOB-2627-0001."
- Confirm with: n/a — read-only.
- Expect: product description, quantity, status OPEN, BOM lines, `materialCost` still null (nothing issued yet). **Negative case:** "Show me job JOB-9999-9999" — expect `JOB_NOT_FOUND`.

### `get_job_bom_variance`
- What it does: BOM-required vs. actually issued/returned, per material, with variance %.
- Log in as: either.
- Try this prompt: "What's the BOM variance on JOB-2627-0001 so far?"
- Confirm with: n/a — read-only.
- Expect: an empty or all-zero variance table (nothing issued yet) — re-run this after the lifecycle walkthrough's `issue_material`/`return_material` steps to see it move. **Negative case:** "BOM variance for job JOB-0000-0000" — expect `JOB_NOT_FOUND`.

---

## Purchasing

### `create_purchase_order`
- What it does: creates a PO, resolving/creating the supplier by name; auto-`PENDING_APPROVAL` above the ₹50,000 threshold, else `APPROVED`.
- Log in as: either.
- Try this prompt: "Order 10 litres of Insulation Varnish from a new supplier, Madurai Chemical Traders, at ₹450/litre."
- Confirm with: a **New Purchase Order** form opens pre-filled with the supplier name and one line. Review, then click "Create purchase order".
- Expect: a new PO, subtotal ₹4,500 — well under threshold — auto-`APPROVED`. **Negative case:** "Order 50kg of 22 SWG Copper Wire from Chennai Wire Traders" (no rate given) — expect `MISSING_RATE`; the tool never guesses a rate from history, even though `get_purchase_price_history` could suggest one.

### `approve_purchase_order`
- What it does: approves a PO currently PENDING_APPROVAL. Owner only.
- Log in as: OWNER.
- Try this prompt: "Approve PO-2627-0002."
- Confirm with: an **Approve Purchase Order** form opens with the PO pre-selected. Review, then click "Approve".
- Expect: `PO-2627-0002` flips to APPROVED. **Negative case:** log in as STOREKEEPER and try the same request — confirmed live: the form still opens (nothing about role is checked before that point), but submitting it reopens the same form with "Couldn't complete that: Role \"STOREKEEPER\" is not permitted to call this tool" — a real refusal, not a silent failure, just one that only surfaces at the submit step rather than up front.

### `reject_purchase_order`
- What it does: rejects a PO currently PENDING_APPROVAL, with a required reason. Owner only.
- Log in as: OWNER.
- Try this prompt: "Actually, reject PO-2627-0002 instead — Ferrite Core E-30 pricing looks too high, we'll shop around." (Do this as an *alternative* to approving it above, in a separate test pass — you can't do both to the same PO.)
- Confirm with: a **Reject Purchase Order** form opens with the PO and reason pre-filled. Review, then click "Reject".
- Expect: `PO-2627-0002` moves to REJECTED with the reason persisted. **Negative case:** "Reject PO-2627-0001, reason: changed my mind" — expect `NOT_PENDING` (`PO-2627-0001` is already APPROVED, not PENDING_APPROVAL).

### `record_goods_receipt`
- What it does: records a GRN against a delivery, splitting each line into accepted/rejected quantity — only accepted stock moves.
- Log in as: either.
- Try this prompt (after approving `PO-2627-0002` above): "Coimbatore Ferrite Supplies delivered against PO-2627-0002 — all 3,000 pieces, fully accepted, invoice CFS/INV/2201."
- Confirm with: a **Record Goods Receipt** form opens pre-filled with supplier/PO/one line. Review, then click "Record receipt".
- Expect: a new GRN, ferrite balance jumps by 3,000pcs, `PO-2627-0002` flips to RECEIVED.
- **Negative case, and another real gap to note:** try recording a receipt against `PO-2627-0002` *before* approving it — expect `PO_NOT_APPROVED` (the form reopens with that error). The tool's own description frames `overrideConfirmed` as a separate, stronger confirmation the orchestrator must ask about explicitly — but `record_goods_receipt.ts`'s `FormSpec` has no `overrideConfirmed` field at all, and (per the general confirm-mechanism note above) mutating tools never ask a clarifying question in chat text either. So today there is **no way to reach the override path through `/db-chat` at all** — worth reporting as a real gap, not something to expect to work around.

### `get_purchase_price_history`
- What it does: a material's purchase rate history from recorded GRNs, most recent first.
- Log in as: either.
- Try this prompt: "What have we historically paid for Ferrite Core E-30?"
- Confirm with: n/a — read-only.
- Expect: the ₹18/pc opening receipt (and the ₹19/pc Coimbatore receipt, once you've recorded it above). No named failure precondition — no history just returns an empty list.

### `list_pending_approvals`
- What it does: everything awaiting OWNER approval — POs and stock counts together.
- Log in as: either.
- Try this prompt: "What's waiting on my approval right now?"
- Confirm with: n/a — read-only.
- Expect: `PO-2627-0002` (until you approve/reject it above). No named failure precondition.

---

## Issue & Return, Scrap, and Corrections

These three groups are best exercised as connected walkthroughs rather than isolated prompts — see **Full Job Lifecycle** and **Fresh Scrap Cycle** below, which cover `issue_material`, `return_material`, `close_job`, `record_scrap_in`, and `record_scrap_sale` in the order a storekeeper would actually use them. Each tool still gets its own negative case there. `reverse_movement` (Corrections) is covered as its own worked example immediately below, since it operates on the already-seeded opening receipt rather than anything from those walkthroughs.

### `reverse_movement` (worked example)
- What it does: reverses a single stock movement, restoring the balance — posts a new opposite-direction entry, never edits the original (append-only ledger).
- Log in as: OWNER only.
- Try this prompt: first, "Show me the movement history for 22 SWG Copper Wire" (`get_movement_history`) to find the RECEIPT movement from `GRN-2627-0001` — then: "I made a mistake on that wire receipt from Chennai Wire Traders — can you undo it? Reason: entered against the wrong GRN."
- Confirm with: a **Reverse Movement** form opens, with `reverse_movement.ts`'s `confirmationCopy` banner shown above the fields ("This posts a permanent correcting entry against the stock ledger — the original movement is never edited or deleted. Confirm the material, quantity, and job below before proceeding."). Review, then click "Reverse movement".
- **⚠ Worth checking, not just assuming.** That banner text is static — it doesn't actually name *this* movement's material, quantity, or resulting balance anywhere (the form's only real fields are `movementId` and `reason`). So despite the tool's own description saying the orchestrator "MUST show the user exactly what will change... before calling this with `confirmed: true`", the form itself never displays the concrete numbers — you're relying on whatever the assistant said in chat text beforehand (check the transcript above the form for that) plus your own read of `get_movement_history` from the first step. Flag it as a problem if neither the chat text nor the form ever states the actual material/quantity/resulting balance before you click "Reverse movement".
- Expect: after confirming, check `get_material_balance` on 22 SWG Copper Wire dropped by 20kg from wherever it currently stands. **Negative case:** log in as STOREKEEPER and try the same request — expect a role refusal at the submit step (the form still opens first, same as `approve_purchase_order` above). (A second negative case, if you want it: try reversing the *same* movement again after the first reversal succeeds — expect `ALREADY_REVERSED`.)

---

## Physical Count

### `start_stock_count`
- What it does: starts a physical count — one `DRAFT` line per target material, `systemQty` frozen from the current balance at the moment you start.
- Log in as: either.
- Try this prompt: "Let's do a spot count today on just the copper wire and ferrite core."
- Confirm with: a **Start Stock Count** form opens pre-filled. Review, then click "Start count".
- Expect: a new `CNT-2627-0002` with two lines, both `countedQty` still empty. No named failure precondition here.

### `submit_count_line`
- What it does: records the counted quantity for one line; a non-zero difference with no reason given is auto-stamped `UNEXPLAINED`.
- Log in as: either.
- Try this prompt: "Counted wire at 18.5kg." (for the line from the count you just started)
- Confirm with: a **Submit Count Line** form opens. Note `stockCountLineId`'s dropdown has no friendly label (`submit_count_line.ts`'s `FormSpec` uses raw `id` as both value and label) — rely on the model's own inference from your message rather than trying to browse it yourself. Review, then click "Submit count line".
- Expect: `differenceQty` computed automatically, reason `UNEXPLAINED` if you didn't give one. **Negative case:** try submitting a count line on the seeded historical count, `CNT-2627-0001` (already APPROVED) — expect `NOT_DRAFT`.

### `submit_stock_count`
- What it does: submits a DRAFT count for owner approval once every line has a counted quantity.
- Log in as: either.
- Try this prompt: submit the wire line above but leave ferrite uncounted, then say "Submit the count for approval."
- Confirm with: a **Submit Stock Count** form opens with the count pre-selected. Review, then click "Submit count".
- Expect: **Negative case first** — with ferrite still uncounted, expect `INCOMPLETE_COUNT`. Then count the ferrite line too, and re-submit — expect a clean move to `PENDING_APPROVAL` with a variance summary.

### `approve_stock_count`
- What it does: approves a PENDING_APPROVAL count; posts one `COUNT_ADJUSTMENT` movement per line with a non-zero difference. Owner only, destructive.
- Log in as: OWNER.
- Try this prompt: "Approve the stock count we just submitted."
- Confirm with: an **Approve Stock Count** form opens with the count pre-selected. Review, then click "Approve".
- Expect: the count flips to APPROVED and the balance shift shows up in `get_material_balance`. **Negative case:** try approving `CNT-2627-0001` again (already APPROVED) — expect `NOT_PENDING`.

### `reject_stock_count`
- What it does: rejects a PENDING_APPROVAL count with a required note; no movements post; every OWNER gets a `RECOUNT_REQUIRED` notification. Owner only.
- Log in as: OWNER — for the happy path, run this as an *alternative* ending to a fresh count instead of approving it (start another count, submit it, then reject it: "Reject that count — the ferrite number looks like a typo, re-count needed.").
- Confirm with: a **Reject Stock Count** form opens with the count and note pre-filled. Review, then click "Reject".
- Expect: the count moves to REJECTED, no stock movement posted. **Negative case:** log in as STOREKEEPER and try to reject a PENDING_APPROVAL count — expect the form to open (as with the other OWNER-only tools above) but the submission to be refused by role.

---

## Reporting

### `get_movement_history`
- What it does: the stock movement ledger, filtered by material and/or job, newest first, cursor-paginated.
- Log in as: either.
- Try this prompt: "Show me every stock movement on JOB-2627-0001 so far."
- Confirm with: n/a — read-only.
- Expect: nothing yet until you've issued material in the lifecycle walkthrough below — then ISSUE/RETURN rows appear. **Negative case:** ask "show me the movement history" with no material or job named at all — the tool requires at least one; expect the agent to either ask which material/job you mean, or a rejected call if it guesses wrong.

---

## Full Job Lifecycle — resolving `JOB-2627-0001`'s shortage end to end

This is the connected walkthrough the individual `issue_material`/`return_material`/`close_job` sections above point to — it exercises the proactive-shortage-surfacing and "ask about returns before closing" behavior that single-tool prompts can't reach.

Remember throughout: every numbered step below that names a mutating tool means "the agent opens that tool's review form, pre-filled from your message — check the fields, then click its submit button" (see the confirmation-mechanism note near the top of this doc), not a chat reply.

1. **Check the standing shortage.** "What are we short on for JOB-2627-0001?" (`check_job_shortage`) — expect wire/ferrite/bobbin shortfalls per the table at the top of this doc.
2. **Resolve the ferrite shortfall.** "Approve PO-2627-0002." (`approve_purchase_order`, OWNER — submit its form) → "Coimbatore Ferrite Supplies delivered the full 3,000 pieces, invoice CFS/INV/2201, fully accepted." (`record_goods_receipt` — submit its form). Re-run step 1's question: ferrite's shortfall should now read 0 (or negative-of-need, i.e. surplus), since 3,000pcs comfortably covers the 205pc shortfall.
3. **Wire and bobbin are still short.** Point this out yourself, or ask "are we still short on anything?" — the agent should proactively flag wire (~6kg) and bobbin (500pcs, never purchased at all) as still outstanding. This is deliberately left unresolved — raising a PO for wire/bobbin is further practice with `create_purchase_order`, not repeated here.
4. **Issue material anyway.** "Issue material to JOB-2627-0001." (`issue_material`, no explicit `lines` in your message — the form's `lines` field can stay empty too, which defaults to the full outstanding BOM requirement) — submit the form. Expect: the job flips to `MATERIAL_ISSUED`; since wire and bobbin are still short, watch for a `warning` about balances going negative, and confirm every OWNER gets a `NEGATIVE_STOCK_WARNING` notification.
5. **Negative case — `JOB_NOT_OPEN`.** Now try "Reset the BOM on JOB-2627-0001 — actually wire should be 0.06kg/pc." (`set_job_bom`) — expect the form to reopen with `JOB_NOT_OPEN` after you submit, since the job is now `MATERIAL_ISSUED`, not `OPEN`.
6. **Partial return.** "We over-issued ferrite — return 40 pieces to stock." (`return_material` — submit its form). Expect ferrite's `returnedQty` on the BOM line to increase and a RETURN movement at the *current* average rate (never caller-supplied).
7. **Negative case — `NOTHING_ISSUED_FOR_MATERIAL`.** Try "Return 2 litres of Insulation Varnish from JOB-2627-0001" — varnish was never in this job's BOM at all — expect `NOTHING_ISSUED_FOR_MATERIAL` when you submit.
8. **Close the job — and another real gap to check for.** "Close out JOB-2627-0001." (`close_job`). `close_job`'s own description says the orchestrator "must" have asked about outstanding unreturned material *in the conversation* before this runs — but per the confirmation-mechanism note above, the agent never asks clarifying questions in chat before opening a mutating tool's form, and `close_job.ts`'s `FormSpec` has only a `jobId` field, no confirmation banner and nothing about outstanding material anywhere. So on the current implementation there is **no point at which this question actually gets asked** — flag that as a real gap against the tool's own documented expectation, don't just check a box. Submit the form anyway. Expect: status `CLOSED`, `materialCost` computed as issued-minus-returned value, and a full per-BOM-line outstanding summary printed regardless of how small the variance is (this summary — after the fact — is the only place the leftover bobbin/wire shortfall actually surfaces).
9. **Negative case — `JOB_NOT_ISSUABLE`.** Try "Issue more wire to JOB-2627-0001" now that it's closed — expect `JOB_NOT_ISSUABLE` when you submit.
10. **Check the final numbers.** "What's the material cost on JOB-2627-0001, and how does it compare to the BOM?" (`get_job` + `get_job_bom_variance`, both read-only) — confirm `materialCost` is populated and the variance table shows real issued/returned figures instead of zeros.

## Fresh Scrap Cycle

1. "We swept up 3.2kg of copper scrap off the floor from the JOB-2627-0001 winding work." (`record_scrap_in` against Copper Scrap, `jobId` optional but nice to include) — submit the form. Expect a SCRAP_IN movement at rate 0 (no cost basis until sold) and Copper Scrap's balance at 3.2kg.
2. **Negative case.** "Record 5kg of wire scrap coming in" (against 22 SWG Copper Wire, which isn't flagged as scrap) — expect the form to reopen with `NOT_SCRAP_MATERIAL` after you submit.
3. "Sold 4kg of copper scrap to a local scrap buyer today at ₹520/kg, invoice SCRAP/0091." (`record_scrap_sale` — submit its form). Note this is selling *more* than the 3.2kg on hand — expect the sale to still succeed (never rejected), with a `warning` field noting the balance will go negative, mirroring `issue_material`'s negative-stock philosophy.

---

## Coverage check

This doc has one section (or one step inside a walkthrough) for every tool in `services/tool-service/src/tools/tools.enabled.json` as of this run: `register`, `login`, `whoami`, `list_rows`, `search_materials`, `create_material`, `update_material`, `deactivate_material`, `get_material_balance`, `create_customer_po`, `create_job`, `set_job_bom`, `check_job_shortage`, `get_job`, `get_job_bom_variance`, `create_purchase_order`, `approve_purchase_order`, `reject_purchase_order`, `record_goods_receipt`, `get_purchase_price_history`, `list_pending_approvals`, `issue_material`, `return_material`, `close_job`, `get_movement_history`, `record_scrap_in`, `record_scrap_sale`, `start_stock_count`, `submit_count_line`, `submit_stock_count`, `approve_stock_count`, `reject_stock_count`, `reverse_movement` — 33 tools. If that count or list ever disagrees with `tools.enabled.json`, this doc is stale — regenerate it.
