---
name: enum-and-constraint-safety
description: "USE WHEN building a form control (dropdown, select, radio group, status badge, category picker) that writes to a database column with a restricted set of allowed values. Prevents writing a value the database will reject."
---

# Enum and constraint safety

## The rule

Any column restricted to a fixed set of values — whether it's a real Postgres enum type or a CHECK constraint — must be discovered via `get_schema`, never guessed. `get_schema` reports this two ways, both already resolved for you:

```
- users: role (public.app_role, allowed: OWNER, STOREKEEPER)
    CONSTRAINT — chk_status: CHECK (status IN ('active', 'inactive', 'pending'))
```

- `allowed: ...` directly on a column line lists an enum's exact values (exact casing — copy them verbatim).
- `CONSTRAINT —` lines below a table describe CHECK/PK/FK/UNIQUE constraints; a CHECK constraint restricting a column to specific values reads the same way as the raw SQL.

## What to do with them

- Populate `<select>`/radio-group options **only** from these reported values — never free-text input, never a value you inferred from the column name or from example data you happened to see in a prior query result (example data may not cover every allowed value, and may use different casing than the constraint).
- If `get_schema` reports **no** constraint or enum for a column that still seems like it should be restricted (e.g. `get_table_constraints`/`get_enum_values` migrations not yet applied in this environment — `get_schema` degrades gracefully and just omits the info rather than failing), don't fabricate one. Use a plain text input instead and note in a code comment that the allowed-values list wasn't available, so a future edit can tighten it once schema introspection reports it.
- Writing an unlisted value fails at the database with a raw constraint-violation error, not a friendly message — the artifact never gets a chance to show a nice validation error for a value that shouldn't have been offered in the first place. Getting the options list right up front is the only real defense.
- When editing an *existing* record whose current value somehow isn't in the reported allowed list (stale data), still render it as the selected option (don't silently drop it), but don't add it back to the list of choices for new selections.
