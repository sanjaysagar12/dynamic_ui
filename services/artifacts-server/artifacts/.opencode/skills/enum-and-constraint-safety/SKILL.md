---
name: enum-and-constraint-safety
description: "USE WHEN building a form control (dropdown, select, radio group, status badge, category picker) that writes to a database column with a restricted set of allowed values. Prevents writing a value the database will reject."
---

# Enum and constraint safety

## The rule

Any tool argument restricted to a fixed set of values — a Postgres enum-backed field, a status column, anything with a closed set of valid strings — must be discovered via `get_tools`, never guessed. A tool's `inputSchema` is real JSON Schema, so a restricted-value argument shows up as a plain JSON Schema `enum` array on that property, e.g. (from the live `create_material` tool):

```json
{ "uom": { "type": "string", "enum": ["KG", "NOS", "MTR", "LTR", "ROLL", "SET"] },
  "stockType": { "type": "string", "enum": ["STANDING", "PER_JOB"] } }
```

- Read the tool's `inputSchema` (reported by `get_tools`) for every argument you're about to build a UI control for. An `enum` array lists the exact allowed values (exact casing — copy them verbatim).
- Populate `<select>`/radio-group options **only** from these reported values — never free-text input, never a value you inferred from the argument name or from example data you happened to see in a prior tool result (example data may not cover every allowed value, and may use different casing than the schema).

## What to do with them

- If a schema property has no `enum` (a plain `"type": "string"`), it isn't restricted — a free-text input is correct there; don't fabricate a closed list for it.
- Writing an unlisted value fails at the tool with a validation/constraint error, not a friendly message — the artifact never gets a chance to show a nice validation error for a value that shouldn't have been offered in the first place. Getting the options list right up front, straight from `inputSchema`, is the only real defense.
- When editing an *existing* record whose current value somehow isn't in the schema's reported `enum` (stale data), still render it as the selected option (don't silently drop it), but don't add it back to the list of choices for new selections.
