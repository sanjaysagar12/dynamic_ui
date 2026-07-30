# Artifact authoring rules

You generate and update small, self-contained web UI artifacts from a user's description, writing the files directly into the current directory (each artifact is one directory under `services/artifacts-server/artifacts/`, named with a short kebab-case slug — letters, digits, hyphens only).

Each artifact is exactly three files: `index.html`, `assets/style.css`, `assets/app.js`. A directory may also contain a `manifest.json` (controls which roles can view the artifact) — that file is managed entirely by the service driving you, not by you: never create, edit, or delete it.

Rules:
- `index.html` must be a complete HTML document that links `assets/style.css` and `assets/app.js` as relative paths.
- Keep the design clean and functional; use plain HTML/CSS/JS only, no external libraries or CDNs (the artifact is served standalone with no network access assumed, and a Content-Security-Policy blocks all outbound network calls from the iframe — see the Tailwind CSS section below for the one built-in exception).
- JS runs inside a sandboxed iframe with no access to any parent page, cookies, or storage — do not rely on any of those.
- Never use `<form>` elements or `type="submit"` buttons. The iframe is sandboxed without `allow-forms`, so any form submission is blocked by the browser regardless of calling `preventDefault()` in JS, and logs a console error. For a submittable input, use a plain `<div>` wrapper, a `<button type="button">` with a click listener, and (optionally) a keydown listener on the input checking for `event.key === 'Enter'`.
- Always write the complete, current content of all three files, not a diff — even when only asked to tweak one detail.
- When updating an existing artifact, keep its slug (the directory name) and preserve everything the user didn't ask you to change.
- Before writing any code that persists or loads data, call the `get_schema` tool so you use the real table/column names and only ever write values that satisfy each table's constraints, instead of guessing either. Skip it for artifacts that only need local, in-memory UI state.

## Styling: use Tailwind CSS utility classes

A complete, offline build of Tailwind CSS is already vendored and served locally (not a CDN) at a fixed path shared by every artifact. In `index.html`, link it BEFORE your own stylesheet:

```html
<link rel="stylesheet" href="../_shared/tailwind.min.css" />
<link rel="stylesheet" href="assets/style.css" />
```

Build the UI primarily with Tailwind utility classes directly on elements (layout: flex/grid, spacing: p-/m-/gap-, color: bg-/text-/border-, typography, rounded-, shadow-, hover:/focus: states, responsive sm:/md:/lg: prefixes, etc.). Only write rules in `assets/style.css` for the rare case Tailwind's utilities can't express (e.g. a custom animation) — don't duplicate what a utility class already does. Still write `assets/style.css` every time (it can be minimal or empty of rules beyond a comment if nothing custom is needed).

## Persisted data: postMessage bridge ONLY — never call Supabase or any API directly

If the artifact needs to read or write data that should persist or be shared (not just local, in-memory UI state), it MUST go through the parent application via postMessage. The artifact runs untrusted, AI-generated code in a sandboxed iframe with no network access and no credentials of its own — it must NEVER hold a database token, NEVER call a Supabase URL, and NEVER call the parent app's REST endpoints (e.g. `/api/data/...`) directly with fetch/XHR. Any of that is a security vulnerability, since the artifact could contain injected malicious code. The ONLY channel to persisted data is this exact postMessage contract, implemented in `assets/app.js`:

```javascript
var pending = {};
var nextRequestId = 1;

window.addEventListener('message', function (event) {
  var data = event.data;
  if (!data || data.source !== 'artifact-data-bridge' || data.type !== 'response') return;
  var callback = pending[data.requestId];
  if (!callback) return;
  delete pending[data.requestId];
  callback(data.status, data.body);
});

function request(method, table, id, body, search) {
  return new Promise(function (resolve, reject) {
    var requestId = 'req-' + nextRequestId++;
    pending[requestId] = function (status, responseBody) {
      if (status >= 200 && status < 300) resolve(responseBody);
      else reject(new Error((responseBody && responseBody.error) || 'Request failed (status ' + status + ')'));
    };
    window.parent.postMessage(
      { source: 'artifact-data-bridge', type: 'request', requestId: requestId, table: table, method: method, id: id, body: body, search: search },
      '*'
    );
  });
}
```

- `method` is one of `"GET"`, `"POST"`, `"PATCH"`, `"DELETE"`. `table` is the real Supabase table name (from `get_schema` — never invented).
- When `id`, `body`, or `search` are not needed, OMIT that argument entirely (or pass `undefined`) — never pass `null`. A `null` body on a GET/DELETE request gets attached as a literal request body, which the browser rejects and turns into a hard failure.
- There is no single-row GET endpoint. GET only lists (with optional filtering): `request('GET', table, undefined, undefined, search)`. To fetch one row, filter by id in search instead: `request('GET', table, undefined, undefined, 'id=' + encodeURIComponent(rowId))`.
- POST creates: `request('POST', table, undefined, { col: value, ... })`. PATCH updates by id: `request('PATCH', table, rowId, { col: value, ... })`. DELETE removes by id: `request('DELETE', table, rowId)`.
- Do not send a `user_id` / owner column in the body — row ownership is applied automatically server-side (via a column default tied to the logged-in user). Only send the columns the user is actually editing.
- `search` is an optional query string of `column=value` pairs, each an exact-match filter (plain values, not PostgREST operator syntax — e.g. `"completed=true"`, NOT `"completed=eq.true"`). Two keys are reserved query modifiers instead of filters: `"order=column.asc"` or `"order=column.desc"` to sort, and `"limit=n"` to cap row count. Combine with `"&"`, e.g. `"completed=false&order=created_at.desc&limit=20"`.
- Response shapes differ by method — handle each correctly:
  - GET (list): resolves to `{ data: [ {...}, {...} ] }` — you MUST read `.data` to get the array.
  - POST: resolves to the created row itself, e.g. `{ id, title, completed, created_at, ... }` — NOT wrapped.
  - PATCH: resolves to the updated row itself — NOT wrapped.
  - DELETE: resolves to `null` (no body).
- The parent authenticates, authorizes, and forwards the request to the real Supabase-backed data layer; the artifact never sees a token or connects to Supabase/any backend directly.
- Some columns have a CHECK constraint restricting them to a fixed set of allowed values (`get_schema` reports these). Any UI control writing to such a column (a status field, a category picker, etc.) MUST only offer/send one of the allowed values — e.g. render it as a `<select>`/button group populated with exactly those values, never free-text. Writing an unlisted value fails at the database with a constraint-violation error, not a friendly validation message.
