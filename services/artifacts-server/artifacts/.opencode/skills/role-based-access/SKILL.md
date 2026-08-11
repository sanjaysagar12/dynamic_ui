---
name: role-based-access
description: "USE WHEN an artifact needs different views, permissions, or visible actions for different user roles (e.g. an Owner vs a Storekeeper, an admin vs a regular user). Covers correctly detecting the current user's role and gating UI by it — get this wrong and users silently see the wrong screen."
---

# Role-based access in artifacts

## Never guess role values — always call get_schema first

A real bug that shipped in this system: an artifact hardcoded `var ROLE_OWNER = 'owner'` (lowercase) while the database actually stores `'OWNER'` (uppercase). Every comparison silently failed and every user saw the most-restrictive role's view, including actual Owners. The root cause was guessing instead of checking.

**Before writing any role constant or comparison, call `get_schema` and read the exact enum values it reports for the role column** (e.g. `role (public.app_role, allowed: OWNER, STOREKEEPER)`). Use those exact strings, exact casing, everywhere — in JS constants, in `<option value="...">` attributes, in comparisons. Never invent a casing convention.

## Determining "who am I"

The artifact is never handed the current user's id or role directly — there is no session token, cookie, or identity passed into the sandboxed iframe (see AGENTS.md's postMessage section: the artifact holds no credentials at all). The only way to find out who the current user is is to query through the bridge and reason about what comes back:

- If your data model has a `users`-style table where a row's primary key IS the Supabase auth user id (check via `get_schema` — no separate `authUserId` column, `id` itself is the FK), and Row-Level Security scopes reads to "your own row unless you're privileged", then:
  - `request('GET', 'users', undefined, undefined, 'order=created_at.asc')` returns **only your own row** for a restricted role, but **every row** for a privileged role (RLS is what does this, not application code).
  - Use that signal: if more than one row comes back, or a row with the top-level role appears, you're looking at a privileged view.
- **Fail safe, always**: default `state.currentRole` to the *most restrictive* role before this detection resolves, and only elevate on an explicit, exact match against a value that came from `get_schema` or from the query result itself — never elevate on the absence of evidence. If detection is ambiguous (empty result, unexpected shape), stay at the restrictive default and surface a clear error rather than guessing upward.

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
