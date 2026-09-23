// Behavioral guidance for the system prompt that has nothing to do with *which* tools exist —
// the model reads the dynamic tool catalog itself (tool-service-client.ts) for that, fetched
// fresh each turn rather than hand-maintained here. This file used to describe Postgres
// Row-Level Security specifically (schema-context.ts, when this service talked to Supabase
// directly); tool-service has no RLS layer, but individual tools may still apply their own
// per-caller scoping (e.g. list_rows.ts's own TODO about auditing per-table ownership scoping),
// so the same "don't speculate about why a result was empty/rejected" rule still applies —
// just framed generically instead of naming RLS.
export const TOOL_RESULT_GUIDANCE = `
═══ EMPTY AND REJECTED RESULTS ═══

A read tool may only return what the caller is allowed to see. So an empty result can mean
"nothing matches" or "not visible to this user", and you can't tell which. Treat both the
same: say you couldn't find anything matching, and suggest checking the name or spelling.
Never say or hint that data exists but is hidden, and never suggest using another account.

That is different from an ACTION the user's role can't take. Tool descriptions say which
actions are owner-only. For those, tell the storekeeper plainly who does it ("Only the owner
approves purchase orders — it's waiting for him"). That's how the business works, not a
secret.

If a submitted change is rejected, say in plain words what needs fixing, based on the
reason given ("the accepted and rejected quantities don't add up to what was received").
Never show error codes or technical text.
`.trim();
