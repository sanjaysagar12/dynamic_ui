---
name: role-based-access
description: "USE WHEN an artifact needs different views, permissions, or visible actions for different user roles (e.g. an Owner vs a Storekeeper, an admin vs a regular user). Covers correctly detecting the current user's role and gating UI by it — get this wrong and users silently see the wrong screen."
---

# Role-based access in artifacts

## Never guess role values — always call get_tools first

A real bug that shipped in this system: an artifact hardcoded `var ROLE_OWNER = 'owner'` (lowercase) while the backend actually stores `'OWNER'` (uppercase). Every comparison silently failed and every user saw the most-restrictive role's view, including actual Owners. The root cause was guessing instead of checking.

**Before writing any role constant or comparison, call `get_tools` and read the exact `requiredRoles` values it reports for the tools you're gating** (e.g. a tool listing `required roles: OWNER`). Use those exact strings, exact casing, everywhere — in JS constants, in `<option value="...">` attributes, in comparisons. Never invent a casing convention.

## Determining "who am I"

The artifact is never handed the current user's id or role directly — there is no session token, cookie, or identity passed into the sandboxed iframe (see AGENTS.md's postMessage section: the artifact holds no credentials at all). Call the `whoami` tool through the bridge to find out — it returns `{ userId, email, role }` directly, resolved server-side from the caller's real session:

```javascript
callTool('whoami', {}).then(function (identity) {
  state.currentRole = identity.role;
  renderForRole();
});
```

- **Fail safe, always**: default `state.currentRole` to the *most restrictive* role (or "unknown") until this call resolves, and only switch to what `whoami` actually reports — never guess or elevate based on the absence of a response. If the call fails or hasn't resolved yet, stay at the restrictive default and let the UI show a loading state rather than the privileged one.
- Don't try to infer role from what rows come back on some other read (e.g. "if I see every row, I must be privileged") — a tool's own scoping isn't guaranteed to work that way, and it's needless guesswork when `whoami` already gives you the real answer directly.

## Gating UI by role

- Central guard function pattern (from a real generated artifact, keep this shape):
  ```javascript
  function isOwner() { return state.currentUser && state.currentUser.role === 'OWNER'; }
  function ensureOwner(action) {
    if (isOwner()) return true;
    toast('You don\u2019t have permission to ' + (action || 'do that') + '. Ask the owner.', 'error');
    return false;
  }
  ```
  Call `ensureOwner('add categories')` (or similar) as the FIRST line of every owner-only action handler — never just hide the button and skip the check, since a determined user can still trigger the underlying function.
- Hide (don't just disable) owner-only nav tabs/buttons for restricted roles — use a CSS class toggled by role (e.g. `.owner-only { display: none }` removed for owners) rather than leaving them visible-but-broken.
- Per the general artifact rules: a restricted role attempting a blocked action must see a clear, specific message (a toast, not a silent no-op and not a broken page).
