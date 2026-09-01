---
name: crud-form-modal
description: "USE WHEN adding a create or edit form for a single record (a product, category, staff member, order, etc.) that persists through the postMessage data bridge. Covers the modal structure, validation, submit handling, and the exact request/response shapes the bridge requires."
---

# CRUD form / modal pattern

## Structure

Use one shared modal for both create and edit (don't build two separate modals):

```javascript
var modalConfirmHandler = null;
function openModal(title, bodyHtml, confirmLabel, onConfirm, confirmClass) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHtml;
  var confirmBtn = $('#modal-confirm');
  confirmBtn.textContent = confirmLabel || 'Confirm';
  confirmBtn.className = 'px-4 py-2 rounded-lg text-white font-semibold ' + (confirmClass || 'bg-indigo-600 hover:bg-indigo-700');
  modalConfirmHandler = onConfirm;
  $('#modal-backdrop').classList.remove('hidden');
  var firstInput = $('#modal-body input, #modal-body select, #modal-body textarea');
  if (firstInput) firstInput.focus();
}
function closeModal() {
  $('#modal-backdrop').classList.add('hidden');
  modalConfirmHandler = null;
}
```

Wire close on: an explicit close button, a Cancel button, and clicking the backdrop itself (`e.target === backdrop`) — but never on `Escape` via a form submission, and never use an actual `<form>` element or `type="submit"` button (the artifact's sandboxed iframe has no `allow-forms`; see the general artifact rules). The confirm button is a plain `<button type="button">` wired to `modalConfirmHandler`.

For "edit", prefill every field from the existing record before opening the modal. For "add", start from empty/default values including any enum-restricted field defaulting to the first allowed value (see the enum-and-constraint-safety skill).

## Validation before submit

Validate required fields and any numeric/format constraints client-side before calling the bridge — don't rely on the database rejection as your only validation, since that produces a raw error string, not a helpful message. Disable the confirm button (or show a spinner state) while the request is in flight so a slow connection doesn't produce a double-submit.

## The bridge call itself

Create and update are two different named tools (find both via `get_tools` — don't assume matching names like `create_x`/`update_x`, confirm they actually exist and read what arguments each one takes). This confirm button's click handler already IS the confirmation step, so it's the one place `confirmed: true` belongs — never earlier:

```javascript
var op = id
  ? callTool('update_material', { materialId: id, name: name, minimumLevel: minimumLevel }, true)
  : callTool('create_material', { name: name, uom: uom, stockType: stockType }, true);
op.then(function (saved) {
  closeModal();
  toast(id ? 'Updated.' : 'Created.', 'success');
  refreshList();
}).catch(function (err) {
  toast('Save failed: ' + err.message, 'error');
});
```

Critical details that are easy to get wrong (from the postMessage bridge contract — see AGENTS.md):
- `callTool(...)` already resolves to the tool's own `data` on success (the created/updated row, unwrapped) — don't unwrap `body`/`ok` yourself again.
- Never send an argument the user didn't actually edit, and never send one the tool's `inputSchema` doesn't define — some fields (id/ownership, or fields a tool documents as immutable after creation) are rejected or ignored server-side; check the schema rather than assuming.
- `confirmed: true` is only sent because this call happens inside the confirm button's own click handler, after the user has already reviewed the form — never set it in a function that could fire before the user has seen a confirmation UI.
- On failure, `err.message` is the tool's own error text — show it in the toast rather than a generic "something went wrong", since it's often the actual reason (e.g. a validation or business-rule rejection, like `create_material`'s duplicate-name check) the user needs to see.

## Delete / deactivate

Not every domain has a real delete tool — some only expose a "deactivate" (soft-delete) tool instead (check `get_tools`; use whichever actually exists, don't assume). Either way: always confirm before calling it (a native `window.confirm(...)` is fine for a small artifact, or reuse the same modal) — a hard-to-reverse action behind one accidental click is a bad pattern regardless of app size, and doubly so if the tool is marked `(destructive)` in the catalog, per AGENTS.md's rule that a destructive confirmation must restate exactly what will change. `callTool(...)` resolves to whatever the tool itself returns on success (which may be `null`, or the now-deactivated row) — treat any non-throw as success and refresh the list.
