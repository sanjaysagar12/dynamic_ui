---
name: data-table-view
description: "USE WHEN displaying a list or table of records with search, filtering, or sorting, fetched through the postMessage data bridge. Covers building the search query string correctly, and consistent loading/empty/error states."
---

# Data table / list view pattern

## Fetching the list

Check `get_tools` for what's actually available: a generic `list_rows` tool (args like `{ table, where, orderBy, limit }` — confirm the exact shape from its own `inputSchema`, don't assume) covers a plain listing; some domains additionally expose a purpose-built search tool (e.g. `search_materials`, args `{ query }`) for server-side text search — prefer that over `list_rows` when one exists and fits, since it avoids fetching the whole table just to filter client-side.

```javascript
function loadMaterials() {
  return callTool('list_rows', { table: 'materials', orderBy: 'name', limit: 100 }).then(function (rows) {
    state.materials = rows; // callTool already resolves to the tool's own data, unwrapped
    renderMaterials();
  });
}
```

If no server-side search tool exists for this data, free-text search has to happen client-side instead — fetch the rows via `list_rows`, then filter the in-memory array by substring match against whatever field the user is searching:

```javascript
function visibleMaterials() {
  var q = state.searchTerm.trim().toLowerCase();
  if (!q) return state.materials;
  return state.materials.filter(function (m) { return m.name.toLowerCase().indexOf(q) !== -1; });
}
```

Debounce the search input's re-render (150-250ms) rather than re-filtering on every keystroke for anything beyond a trivial row count, so typing doesn't feel janky. If a real search tool exists instead, debounce the tool call itself the same way rather than firing one per keystroke.

## Loading, empty, and error states

Every list view needs three states, not just the happy path:
- **Loading**: show something immediately (a skeleton row or a simple "Loading…" text) rather than a blank table while the first request is in flight.
- **Empty**: distinguish "no records exist yet" from "no records match the current filter" — the messages and any call-to-action should differ ("Add your first product" vs "No products match this search").
- **Error**: a failed fetch should show a retry-capable message in the table area, not just a toast that disappears — toasts are for the result of an *action* (save/delete), not for "the list itself failed to load".

## Refreshing after a mutation

After any create/update/deactivate in a modal (see the crud-form-modal skill), re-run the same `loadX()` function that populated the list rather than manually splicing the changed row into local state — it's less code, it can't drift out of sync with server-computed fields (defaults, timestamps, server-side totals), and it naturally picks up anything a tool's own scoping might now show or hide.
