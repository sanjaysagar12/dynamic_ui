# Dynamic UI — Architecture Overview

This Nx workspace implements an **Artifacts platform**: a static-file server that serves role-gated "artifacts" (self-contained HTML/CSS/JS bundles) similarly to Apache, a Supabase middle layer that holds the only database credentials in the system, an AI agent that drives [opencode](https://opencode.ai) to generate and update artifacts from a chat prompt, and a Next.js viewer that renders artifacts in a sandboxed iframe and mediates their data access over `postMessage`.

```
apps/
  artifacts-viewer/     Next.js app — AI chat page, sandboxed iframe viewer + postMessage data bridge (port 4200)
services/
  artifacts-server/     Express app — serves artifacts, enforces auth + role authorization + a locked-down CSP (port 3000)
                          artifacts/.opencode/tool/get_schema.ts + artifacts/AGENTS.md — opencode's project-local schema
                          tool and artifact-authoring instructions, shared by every artifact directory underneath
  supabase-service/      Express app — anon-key-only middle layer between the parent app and Supabase; also verifies
                          Supabase access tokens for other services (port 3335)
  agent-service/         Python/FastAPI app — turns a chat prompt into an artifact by shelling out to opencode (port 5002)
packages/
  shared-auth/           Shared TypeScript library — Role types
```

These services run independently and talk to each other only over HTTP; there is no shared runtime state.

---

## 1. `packages/shared-auth`

A small library shared by all the Node services (and, for its browser-safe half, by the Next.js app).

It has **two entry points** so that browser bundles never pull in `jsonwebtoken` (a Node-only dependency):

- **`@org/shared-auth`** (`src/index.ts`) — browser-safe:
  - `Role` — `'admin' | 'manager'`
  - `ROLES` — the list of valid roles
  - `isRole(value)` — type guard
  - `AuthTokenPayload` / `VerifiedAuthToken` — JWT payload shapes
- **`@org/shared-auth/server`** (`src/server.ts`) — Node-only:
  - `JwtService` — `sign(payload)` / `verify(token)`, backed by `jsonwebtoken`
  - `InvalidTokenError` — thrown by `verify()` on a bad/expired/mis-signed token

Any project that only needs `Role`/`isRole` (like the Next.js client components) imports the main entry; anything that actually signs or verifies tokens imports `/server`.

---

## 2. `services/backend-server` (port 3334)

Issues development JWTs. Stands in for a real identity provider.

**Endpoint:**
```
GET /auth/dev-token?role=admin|manager
→ 200 { "token": "<jwt>", "role": "admin", "tokenType": "Bearer" }
→ 400 if role is missing/invalid
```
```
GET /health → 200 { "status": "ok" }
```

**Structure:**
- `config.ts` — reads `PORT` (default `3334`), `JWT_SECRET`, `JWT_ISSUER` (default `backend-server`), `JWT_EXPIRES_IN` (default `1h`)
- `services/token.service.ts` — wraps `JwtService` from `@org/shared-auth/server`, mints a token with a random `sub` (UUID) and the requested role
- `controllers/auth.controller.ts` — Express router validating the `role` query param via `isRole`
- `app.ts` / `main.ts` — wiring and startup

---

## 3. `services/artifacts-server` (port 3000)

Serves artifacts from disk the way Apache serves static files — folder structure maps directly to URL structure — but every artifact is gated by a JWT + a per-artifact `manifest.json` declaring which roles may view it.

**Artifact folder layout** (lives at `services/artifacts-server/artifacts/`):
```
artifacts/
  dashboard/
    index.html
    manifest.json      { "roles": ["admin", "manager"] }
    assets/style.css
    assets/app.js
  admin/
    users/
      index.html
      manifest.json     { "roles": ["admin"] }
      assets/style.css
      assets/app.js
  _shared/
    manifest.json       { "roles": ["admin", "manager"] }
    tailwind.min.css    vendored offline Tailwind CSS build, shared by every artifact
```
`/dashboard/` and `/admin/users/` map 1:1 to `GET /dashboard/` and `GET /admin/users/` on the server. Nested asset requests (e.g. `/admin/users/assets/app.js`) resolve against the nearest ancestor directory that has a `manifest.json`, so an artifact's whole subtree shares one manifest. `_shared/` (and any other `_`-prefixed folder) rides the same manifest-gated resolution/auth pipeline as a real artifact — any authenticated user can fetch `/_shared/tailwind.min.css` — but is excluded from the public artifact catalog (see `artifact-catalog.service.ts`), so it never shows up as a selectable artifact in the UI.

**Request pipeline**, each concern in its own class:

| Module | Responsibility |
|---|---|
| `resolution/artifact-path-resolver.ts` | Maps a URL path → filesystem file, walking up to find the owning artifact directory (the nearest ancestor with `manifest.json`). Blocks path traversal and direct `manifest.json` access. Emits a trailing-slash redirect when a directory is requested without `/`. |
| `manifest/manifest-repository.ts` | Loads + caches `manifest.json` for an artifact directory. |
| `auth/authentication-provider.ts` + `jwt-authentication-provider.ts` | `AuthenticationProvider` interface with a JWT implementation — reads a Bearer header **or** a `?token=` query param (iframe `src` navigations can't set headers). |
| `authorization/authorization-strategy.ts` + `role-authorization-strategy.ts` | `AuthorizationStrategy` interface; the current implementation checks the authenticated role against `manifest.roles`. |
| `service/artifact-service.ts` | Orchestrates resolve → load manifest → authenticate → authorize. |
| `service/artifact-catalog.service.ts` | Walks the artifacts tree for the public catalog (`GET /api/artifacts`), skipping any path segment starting with `_`. |
| `http/artifacts.router.ts` | Express router; maps errors to `401` (no/invalid token), `403` (role not permitted), `404` (artifact not found); sets `Content-Security-Policy: connect-src 'none'` on every served HTML document. |
| `http/html-token-rewriter.ts` | Appends the auth token to every relative `href`/`src` in served HTML, since the browser's own sub-resource requests (`<link>`, `<script>`) never see the query-param token a top-level iframe navigation carries. |

Both `AuthenticationProvider` and `AuthorizationStrategy` are interfaces specifically so new auth methods (API keys, sessions) or authorization rules (ABAC, per-user overrides) can be added without touching the rest of the pipeline.

**Config** (`config.ts`): `PORT` (default `3000`), `ARTIFACTS_ROOT` (default `<project>/artifacts`), `JWT_SECRET`, `JWT_ISSUER` (default `backend-server` — **must match** `backend-server`'s issuer for token verification to succeed).

**Security note — CSP:** the iframe `sandbox` attribute alone does not restrict outbound network calls (fetch/XHR/WebSocket) from artifact JS, only DOM/storage/navigation. `Content-Security-Policy: connect-src 'none'` on every artifact HTML response is what actually closes that gap — see `artifacts/sandbox-security-test/` for a live artifact that deliberately attempts every attack this is meant to block (localStorage/sessionStorage/cookies, parent-DOM access, external fetch, and direct calls to `supabase-service`/the parent's `/api/data`) and reports whether each was actually blocked.

---

## 4. `services/supabase-service` (port 3335)

The **only** thing in the system that talks to Supabase at request time, and it does so using **only the Supabase anon/publishable key** — never a secret/service-role key. It sits between the parent app (`artifacts-viewer`) and Supabase: the parent logs a user in through here (getting back a Supabase JWT + user id), then makes every subsequent data request through here, attaching that same user JWT so Postgres Row-Level Security — not this service — is what actually scopes what a caller can read or write.

**Endpoints:**
```
POST /auth/signup   { email, password }  → creates a Supabase user, returns { accessToken, userId, email }
POST /auth/login    { email, password }  → signs in, returns { accessToken, userId, email }
GET  /data/:table              ?column=value&order=col.asc|desc&limit=n   → { data: [...] }  (list, RLS-scoped)
POST /data/:table   { ...fields }                                          → the created row (bare, not wrapped)
PATCH /data/:table/:id  { ...fields }                                      → the updated row (bare, not wrapped)
DELETE /data/:table/:id                                                    → 204 no body
GET  /health
```
`:table` is schema-agnostic (validated against a plain identifier regex) — this works against any table, not a hardcoded one. In `/data/:table` list requests, every query-string key is treated as an exact-match column filter **except** two reserved keys: `order` (`column.asc` / `column.desc`) and `limit` (row count) — see `data/records.service.ts`.

**Structure:**
- `supabase/supabase-client-factory.ts` — `SupabaseClientFactory`: builds a `@supabase/supabase-js` client scoped to a specific user by attaching `global.headers.Authorization: Bearer <user JWT>` (not `.auth.setSession()`), always constructed with the anon key
- `auth/auth.service.ts` / `auth.controller.ts` — sign-up/sign-in against Supabase Auth
- `auth/require-supabase-auth.ts` — middleware requiring a valid `Authorization: Bearer <token>` + `X-User-Id` header on `/data/*`
- `data/records.service.ts` — `RecordsService`: the generic list/create/update/remove proxy described above
- `data/records.controller.ts` — Express router wiring the above to HTTP verbs
- `config.ts` — `PORT` (default `3335`), `SUPABASE_URL`, `SUPABASE_ANON_KEY`

**Why no `/schema` endpoint here:** Supabase's own schema/OpenAPI introspection endpoint rejects anon keys outright ("Secret API key required"), which conflicts with this service's anon-key-only design. Schema introspection instead lives in opencode's own `get_schema` tool (§6), which is allowed to hold a secret key because it's never in the runtime request path for artifact data.

---

## 5. `services/agent-service` (port 5002, Python/FastAPI)

Takes a natural-language chat prompt and drives [opencode](https://opencode.ai) — run as a subprocess, one invocation per chat turn — to generate or edit the artifact's files directly on disk. There is no intermediate "write artifact" service anymore: opencode has real `read`/`write`/`edit` tools and operates straight against `services/artifacts-server/artifacts/<slug>/`, the same directory `artifacts-server` serves from.

**Endpoints:**
```
GET  /agent/providers                          → { default, providers: [{id, label, model}] } — for populating a model picker
POST /agent/generate-artifact  { prompt, slug?, roles?, provider?, model? }  → one-shot create (thin wrapper around /chat)
POST /agent/chat  { messages, slug?, roles?, provider?, model? }             → multi-turn create/update, returns updated message history
GET  /health
```

**How a chat turn works** (`app/services/chat_service.py`):
1. Resolve the artifact's `slug` — the caller's `slug` if editing, otherwise a deterministic slugified form of the first message (`app/services/slug.py`; no LLM round-trip just to name the folder).
2. Resolve which model opencode should use: `--model anthropic/<model>` or `--model google/<model>`, built from the request's `provider`/`model` (or the `claude`/`gemini` defaults) — see `PROVIDER_MODEL_PREFIX` in `config.py`. Provider *credentials* are opencode's own concern (`opencode auth login`, or `ANTHROPIC_API_KEY`/`GEMINI_API_KEY` inherited from this process's environment), not something this service holds.
3. Run opencode (`app/services/opencode_runner.py`): `opencode run --dir <artifact_dir> --format json --model <model> [--session <id>] "<prompt>"` as a subprocess, parsing its newline-delimited JSON event stream for the final assistant text (the `reply`) and its session id. A session id is cached per slug (in-memory) so a follow-up edit continues the same opencode session instead of re-discovering the directory from scratch; when there's no session to continue, the full message transcript is reconstructed into the prompt instead of just the latest message, so context is never silently lost.
4. Write `manifest.json` directly (`app/services/manifest.py`) — the roles/title convention artifacts-server's catalog and authorization depend on. opencode never touches this file itself (see `AGENTS.md` below); this service does it after a successful run, so a failed/partial opencode run never leaves a manifest for broken content.
5. Enumerate whatever files actually changed on disk (`artifact_dir.rglob("*")`, excluding `manifest.json`) to report `files_written` — no separate service call needed since this process already has the artifacts-root filesystem.

opencode itself gets its capabilities from two project-local files under `services/artifacts-server/artifacts/`, discovered automatically by walking up from the artifact's own directory:
- **`AGENTS.md`** — the three-file artifact shape (`index.html`, `assets/style.css`, `assets/app.js`), no `<form>`/`type="submit"` (sandboxed without `allow-forms`), no external libraries/CDNs, Tailwind usage (link `../_shared/tailwind.min.css` before `assets/style.css`), the exact `postMessage` data-bridge wire protocol artifacts must use for persisted data (mirrors `useArtifactDataBridge.ts`, § 7), and an instruction to never touch `manifest.json`.
- **`.opencode/tool/get_schema.ts`** — a custom opencode tool (ported from the schema-introspection logic that used to live in a separate `tool-service`) that calls Supabase's `GET /rest/v1/` with `Accept: application/openapi+json` **using the secret key**, plus a `get_table_constraints` RPC for primary/foreign/unique/check constraints, formatted for the model to read before writing any persistence code.

**Config** (`app/config.py`): `PORT` (default `5002`), `ARTIFACTS_SERVER_URL`, `ARTIFACTS_ROOT` (default `../artifacts-server/artifacts`), `OPENCODE_BIN` (default `opencode`, resolved via `PATH`), `OPENCODE_TIMEOUT_SECONDS` (default `300`), `LLM_PROVIDER`/`ANTHROPIC_MODEL`/`GEMINI_MODEL` (default model choices), plus `SUPABASE_URL`/`SUPABASE_SECRET_KEY` — needed here (not just historically in a separate service) because the opencode subprocess inherits this process's environment, and that's what its `get_schema` tool reads.

**Why the secret key is safe here:** `get_schema` is only ever invoked by opencode at artifact-*generation* time, server-side, to look up real table/column names before writing code — it is never in the path of a running artifact's data requests (those go through `supabase-service`, anon-key-only, RLS-scoped). No artifact, and no browser code, ever sees this key or this endpoint.

---

## 6. `apps/artifacts-viewer` (port 4200)

A Next.js (App Router) app that lets a user pick a role and an artifact, fetches a token, renders the artifact in an isolated iframe, and mediates all of that artifact's data access over `postMessage` — the artifact itself never receives a Supabase token or calls any backend directly.

**Artifact rendering flow:**
1. Browser calls this app's own `GET /api/token?role=...` (same-origin, no CORS needed).
2. That Route Handler calls `backend-server`'s `/auth/dev-token` **server-side** (a BFF pattern — the browser never talks to `backend-server` directly, and `BACKEND_SERVICE_URL` never reaches the client bundle).
3. The token comes back to the browser, which builds `http://localhost:3000/<artifact-path>/?token=<jwt>` and sets it as the iframe `src` (a query param, not a header, because a plain iframe navigation can't attach `Authorization`).
4. `artifacts-server` validates the token and manifest exactly as described above and returns the artifact — or a JSON error, which just renders as text inside the frame.

**Persisted-data flow (the `postMessage` bridge):**
1. The user logs into Supabase through this app's own UI (`SupabaseSessionWidget.tsx`), which posts to `POST /api/supabase/login` (or `/signup`) — a BFF route that calls `supabase-service`'s `/auth/login`. The resulting `{ accessToken, userId, email }` is held in React state (`supabase-session-context.tsx`), never in `localStorage`/cookies.
2. The artifact's JS posts `{ source: 'artifact-data-bridge', type: 'request', requestId, table, method, id, body, search }` to `window.parent` — it holds no credentials and cannot reach any backend on its own (sandboxed, no `allow-same-origin`, and `connect-src 'none'` blocks any outbound call it might attempt anyway).
3. `useArtifactDataBridge.ts` validates the sender via `event.source === iframe.contentWindow` (**not** `event.origin`, since a sandboxed iframe's origin is the opaque string `"null"`), then makes the real request itself — `fetch('/api/data/<table>[/<id>][?search]', { headers: { Authorization: Bearer <supabase token>, X-User-Id } })` — using the logged-in user's own session.
4. `app/api/data/[table]/route.ts` and `[id]/route.ts` are a thin BFF proxy to `supabase-service`'s `/data/:table` endpoints (no CORS — deliberately, as defense-in-depth against any artifact that somehow tried to call them directly).
5. The result is posted back to the iframe as `{ source: 'artifact-data-bridge', type: 'response', requestId, status, body }`.

**Modules:**
- `lib/config/env.ts` — `getBackendServiceUrl()`, `getArtifactsServerUrl()`, `getAgentServiceUrl()`, `getSupabaseServiceUrl()` (all server-only defaults except the artifacts server URL, which the browser also needs to build the iframe `src`)
- `lib/api/backend-service-client.ts`, `lib/api/supabase-service-client.ts`, `lib/api/agent-service-client.ts`, `lib/api/artifacts-catalog-client.ts` — server-only (`import 'server-only'`) clients for each backend
- `app/api/token/route.ts`, `app/api/supabase/{login,signup}/route.ts`, `app/api/data/[table]/{route.ts,[id]/route.ts}`, `app/api/artifacts/route.ts`, `app/api/chat/{route.ts,providers/route.ts}` — the BFF routes bridging browser ↔ each backend
- `lib/supabase/supabase-session-context.tsx` — React context holding the Supabase session, plus `login`/`signUp`/`logout`
- `hooks/useArtifactDataBridge.ts` — the postMessage mediator described above
- `hooks/useArtifactToken.ts`, `hooks/useArtifactSrc.ts` — token fetching and iframe `src` construction
- `components/RoleSwitcher.tsx`, `ArtifactSelector.tsx`, `ArtifactFrame.tsx`, `ArtifactViewer.tsx`, `supabase/SupabaseSessionWidget.tsx` — the UI, composed in `app/page.tsx`

**Iframe sandboxing** (`ArtifactFrame.tsx`) — artifacts are treated as untrusted, potentially AI-generated (and thus potentially adversarial) content:
- `sandbox="allow-scripts"` **only** — no `allow-same-origin` (the framed document gets a unique opaque origin, so it can't read this app's — or even its own origin's — cookies/storage), no forms, popups, top-navigation, downloads, or modals.
- No `allow` (Permissions Policy) features are delegated.
- `referrerPolicy="no-referrer"` — this app's URL is never sent to the artifacts server as a `Referer` header.
- The iframe is keyed by `src`, so switching role or artifact fully remounts it rather than reusing stale state.
- `artifacts-server` additionally sends `Content-Security-Policy: connect-src 'none'` on every artifact document, so even outbound network calls the sandbox attribute itself doesn't restrict are blocked at the browser level.

### AI chat page (`/chat`)

Lets a user create or update an artifact by chatting instead of hand-writing HTML. Reuses `RoleSwitcher` and `ArtifactFrame` from the main viewer for the live preview pane — same token flow, same sandboxing.

- `app/chat/page.tsx` → `components/chat/ChatPage.tsx` — owns the conversation state (`messages`, the target `slug`, selected `provider`, preview `role`)
- `components/chat/ChatMessageList.tsx`, `ChatComposer.tsx`, `ProviderSelector.tsx` — presentational pieces
- `lib/chat/types.ts` — the wire types shared between the proxy and the UI

Flow: composer submits → optimistic user message appended → `POST /api/chat` with the full message list, the current `slug` (`null` on the first turn), and the selected provider → `agent-service` returns the assistant's reply plus the artifact's `url_path` → the page adopts the returned `slug`/`url_path` so the *next* message updates the same artifact instead of creating a new one, and the preview pane's iframe reloads against it.

---

## Security model summary

| Concern | Mechanism |
|---|---|
| Artifact can't read parent cookies/storage/DOM | `sandbox="allow-scripts"` with no `allow-same-origin` → opaque origin |
| Artifact can't submit forms / navigate top / open popups | No `allow-forms`/`allow-top-navigation`/`allow-popups` on the sandbox attribute |
| Artifact can't make its own network calls (external or internal) | `Content-Security-Policy: connect-src 'none'` on every artifact HTML response |
| Artifact can't hold or leak a real Supabase/database credential | It never receives one — all data access goes through `postMessage` → `useArtifactDataBridge.ts`, which holds the session and makes the request itself |
| A forged/spoofed `postMessage` sender | Validated via `event.source === iframe.contentWindow`, not `event.origin` (which is `"null"` for a sandboxed frame either way) |
| Row-level authorization on actual data | Postgres RLS policies (`auth.uid() = user_id`, etc.) — enforced by Supabase itself against the user's own JWT, not application code |
| Runtime Supabase access is over-privileged | `supabase-service` uses **only** the anon key, always scoped to the calling user's JWT (`global.headers.Authorization`) |
| Schema introspection needs a secret key Supabase requires for that endpoint | Isolated to opencode's own `get_schema` tool — generation-time only, never in any runtime artifact/data request path |
| AI-generated code doesn't know the real schema | The `get_schema` tool fetches real table/column/constraint names before code is written |

`services/artifacts-server/artifacts/sandbox-security-test/` is a live artifact that exercises every row in this table (except the RLS/schema ones, which aren't reachable from an artifact by design) and reports pass/fail for each — open it any time to re-verify the sandbox after changing anything here.

---

## Running everything locally

See the top-level [README.md](./README.md) for step-by-step setup and run instructions, including which `.env` files need which keys.

## Status

Everything above is implemented, builds, typechecks, and lints. Verified end-to-end live against a real Supabase project: Supabase login → role-based 200/403/404 responses → sandboxed rendering; the full agent-service → opencode → artifacts-server chain (both creating a new artifact and editing an existing one across turns); the postMessage data bridge performing real CRUD against Supabase through RLS; `get_schema` returning the real database schema via the secret key held only by opencode's tool; the CSP blocking external/internal fetches from inside the sandboxed iframe. Not yet built: an artifact publishing/upload flow beyond the agent, and e2e test suites (removed from this workspace for now).
