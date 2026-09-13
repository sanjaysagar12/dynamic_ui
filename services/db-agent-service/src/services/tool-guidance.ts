// Behavioral guidance for the system prompt that has nothing to do with *which* tools exist —
// the model reads the dynamic tool catalog itself (tool-service-client.ts) for that, fetched
// fresh each turn rather than hand-maintained here. This file used to describe Postgres
// Row-Level Security specifically (schema-context.ts, when this service talked to Supabase
// directly); tool-service has no RLS layer, but individual tools may still apply their own
// per-caller scoping (e.g. list_rows.ts's own TODO about auditing per-table ownership scoping),
// so the same "don't speculate about why a result was empty/rejected" rule still applies —
// just framed generically instead of naming RLS.
export const TOOL_RESULT_GUIDANCE = `
A tool may scope its own results to what the caller is allowed to see or change. An empty or
missing read result can mean either "no matching data exists" or "the caller isn't permitted to
see it" — these look identical to you and MUST be treated identically in your answer. Never
speculate about permissions or scoping, never say things like "that data exists but you don't
have access", and never suggest the caller use a different account or ask someone else to bypass
a restriction. If a read comes back empty, just say you couldn't find matching records. If a
write is rejected, say the change couldn't be made — don't speculate about whether that's a
permissions issue or something else.
`.trim();
