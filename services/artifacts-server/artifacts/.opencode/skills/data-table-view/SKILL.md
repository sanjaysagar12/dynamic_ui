---
name: data-table-view
description: "USE WHEN displaying a list or table of records with search, filtering, or sorting, fetched through the postMessage data bridge. Covers building the search query string correctly, and consistent loading/empty/error states."
---

# Data table / list view pattern

## Building the search query

The bridge's `search` argument is a plain query string of `column=value` pairs — **exact-match filters only**, not PostgREST operator syntax (`completed=true`, never `completed=eq.true`). Two keys are reserved as modifiers instead of filters:

- `order=column.asc` or `order=column.desc` — sort.
- `limit=n` — cap row count.

Combine with `&`:

```javascript
function loadProducts() {
  var parts = [];
  if (state.categoryFilter) parts.push('category_id=' + encodeURIComponent(state.categoryFilter));
  parts.push('order=name.asc');
  return request('GET', 'products', undefined, undefined, parts.join('&')).then(function (res) {
    state.products = res.data; // GET list responses are always { data: [...] } — read .data
    renderProducts();
  });
}
```

Exact-match filtering means **free-text search has to happen client-side**, not by sending the search term as a filter — the bridge has no `ILIKE`/contains support. Fetch the (filtered-by-real-columns) rows, then filter the in-memory array by substring match against whatever field the user is searching:

```javascript
function visibleProducts() {
  var q = state.searchTerm.trim().toLowerCase();
  if (!q) return state.products;
  return state.products.filter(function (p) { return p.name.toLowerCase().indexOf(q) !== -1; });
}
```

Debounce the search input's re-render (150-250ms) rather than re-filtering on every keystroke for anything beyond a trivial row count, so typing doesn't feel janky.

## Loading, empty, and error states

Every list view needs three states, not just the happy path:
- **Loading**: show something immediately (a skeleton row or a simple "Loading…" text) rather than a blank table while the first request is in flight.
- **Empty**: distinguish "no records exist yet" from "no records match the current filter" — the messages and any call-to-action should differ ("Add your first product" vs "No products match this search").
- **Error**: a failed fetch should show a retry-capable message in the table area, not just a toast that disappears — toasts are for the result of an *action* (save/delete), not for "the list itself failed to load".

## Refreshing after a mutation

After any create/update/delete in a modal (see the crud-form-modal skill), re-run the same `loadX()` function that populated the list rather than manually splicing the changed row into local state — it's less code, it can't drift out of sync with server-computed fields (defaults, timestamps, server-side totals), and it naturally picks up anything RLS might now show or hide.
