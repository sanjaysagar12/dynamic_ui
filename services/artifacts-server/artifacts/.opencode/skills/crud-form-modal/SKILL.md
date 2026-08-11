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

```javascript
var op = id
  ? request('PATCH', 'products', id, { name: name, price: price })
  : request('POST', 'products', undefined, { name: name, price: price });
op.then(function (saved) {
  closeModal();
  toast(id ? 'Updated.' : 'Created.', 'success');
  refreshList();
}).catch(function (err) {
  toast('Save failed: ' + err.message, 'error');
});
```

Critical details that are easy to get wrong (from the postMessage bridge contract):
- POST's response is the created row **itself**, not wrapped — same for PATCH's updated row. Only GET (list) responses are wrapped as `{ data: [...] }`.
- Never send a body field the user didn't actually edit — omit ids/ownership columns entirely (they're applied server-side).
- Omit unused arguments to `request(...)` entirely rather than passing `null` — a `null` body on the wrong method is rejected by the browser before the request is even sent.
- On failure, `err.message` is the server's error text — show it in the toast rather than a generic "something went wrong", since it's often the actual reason (e.g. a constraint violation) the user needs to see.

## Delete

Always confirm before delete (a native `window.confirm(...)` is fine for a small artifact) — a destructive action behind one accidental click is a bad pattern regardless of app size. Delete resolves to `null`; treat any non-throw as success and refresh the list.
