# Dynamic UI — Architecture Overview

This Nx workspace implements an **Artifacts platform**: a static-file server that serves role-gated "artifacts" (self-contained HTML/CSS/JS bundles) similarly to Apache, a Supabase middle layer that holds the only database credentials in the system and is also the sole authority on "who is this caller and what role do they have", an AI agent that drives [opencode](https://opencode.ai) to generate and update artifacts (and their reusable Skills) from a chat prompt, and a Next.js viewer that renders artifacts in a sandboxed iframe and mediates their data access over `postMessage`.

Identity is real Supabase Auth throughout — there is no dev-JWT stand-in service anymore. A user logs in once with Supabase; every other service that needs to know who they are (and what role they have) asks `supabase-service`, never decodes anything itself.

```
apps/
  artifacts-viewer/     Next.js app — AI chat page, sandboxed iframe viewer + postMessage data bridge (port 4200)
services/
  artifacts-server/     Fastify app — serves artifacts, verifies the caller via supabase-service + a locked-down CSP (port 3000)
                          artifacts/.opencode/tool/get_schema.ts, artifacts/.opencode/skills/*/SKILL.md, and
                          artifacts/AGENTS.md — opencode's project-local schema tool, reusable Skills, and
                          artifact-authoring instructions, shared by every artifact directory underneath
  supabase-service/      Fastify app — anon-key-only middle layer between the parent app and Supabase; also the
                          only place that turns a Supabase access token into a verified identity + role (port 3335)
  agent-service/         TypeScript/Fastify app — turns a chat prompt into an artifact by shelling out to opencode,
                          and owns CRUD for opencode Skills (port 5002)
packages/
  shared-auth/           Shared TypeScript library — the Role type and the canonical list of valid roles
```

These services run independently and talk to each other only over HTTP; there is no shared runtime state.

---

## 1. `packages/shared-auth`

A tiny library shared by the Node services and the Next.js app's browser bundle. The valid-roles list lives in exactly one place — `src/lib/roles.ts` (currently `["OWNER", "STOREKEEPER"]`) — so adding or renaming a role is a one-file change instead of hunting through every service:

```ts
export const ROLES = ['OWNER', 'STOREKEEPER'] as const;

export type Role = string;
export const ROLES: readonly Role[]; // re-exported from roles.ts
export function isRole(value: unknown): value is Role;
```

`roles.ts` is a plain TypeScript module — no JSON import-attribute machinery, no filesystem reads at runtime — which keeps this package safe to bundle directly into browser code (no Node-only APIs), which matters because `apps/artifacts-viewer`'s client components import `Role`/`ROLES` directly. There used to be a Node-only `/server` entry point (a hand-rolled JWT sign/verify service) — it's gone; nothing in the system mints or verifies its own tokens anymore, Supabase does that.

---

## 2. `services/artifacts-server` (port 3000)

Serves artifacts from disk the way Apache serves static files — folder structure maps directly to URL structure — but every artifact is gated by a **verified Supabase identity** + a per-artifact `manifest.json` declaring which roles may view it.

**Artifact folder layout** (lives at `services/artifacts-server/artifacts/`):
```
artifacts/
  AGENTS.md             opencode's artifact-authoring rules — shared by every artifact directory below
  .opencode/
    tool/get_schema.ts  opencode's Supabase schema-introspection tool
    skills/*/SKILL.md   reusable, on-demand procedures opencode can invoke (see §4)
  dashboard/
    index.html
    manifest.json      { "roles": ["OWNER", "STOREKEEPER"] }
    assets/style.css
    assets/app.js
  admin/
    users/
      index.html
      manifest.json     { "roles": ["OWNER"] }
      assets/style.css
      assets/app.js
  _shared/
    manifest.json       { "roles": ["OWNER", "STOREKEEPER"] }
    tailwind.min.css    vendored offline Tailwind CSS build, shared by every artifact
```
`/dashboard/` and `/admin/users/` map 1:1 to `GET /dashboard/` and `GET /admin/users/` on the server. Nested asset requests (e.g. `/admin/users/assets/app.js`) resolve against the nearest ancestor directory that has a `manifest.json`, so an artifact's whole subtree shares one manifest. `_shared/` (and any other `_`-prefixed folder) rides the same manifest-gated resolution/auth pipeline as a real artifact — any authenticated user can fetch `/_shared/tailwind.min.css` — but is excluded from the public artifact catalog (see `artifact-catalog.service.ts`), so it never shows up as a selectable artifact in the UI. `AGENTS.md` and `.opencode/` are excluded from `.gitignore`'s otherwise-blanket ignore of this directory (everything else here is AI-generated content, not source).

**Request pipeline**, each concern in its own class:

| Module | Responsibility |
|---|---|
| `resolution/artifact-path-resolver.ts` | Maps a URL path → filesystem file, walking up to find the owning artifact directory (the nearest ancestor with `manifest.json`). Blocks path traversal and direct `manifest.json` access. Emits a trailing-slash redirect when a directory is requested without `/`. |
| `manifest/manifest-repository.ts` | Loads + caches `manifest.json` for an artifact directory. |
| `auth/authentication-provider.ts` + `supabase-authentication-provider.ts` | `AuthenticationProvider` interface (`authenticate(req): Promise<AuthContext \| null>`) with a `SupabaseAuthenticationProvider` implementation — reads a Bearer header **or** a `?token=` query param (iframe `src` navigations can't set headers), then forwards that token to `supabase-service`'s `POST /auth/verify` over HTTP. It never decodes or trusts the token itself; a failed/invalid/missing token all resolve to `null`. |
| `authorization/authorization-strategy.ts` + `role-authorization-strategy.ts` | `AuthorizationStrategy` interface; the current implementation checks the verified role against `manifest.roles`. |
| `service/artifact-service.ts` | Orchestrates resolve → load manifest → authenticate (awaits the HTTP round-trip) → authorize. |
| `service/artifact-catalog.service.ts` | Walks the artifacts tree for the public catalog (`GET /api/artifacts`), skipping any path segment starting with `_`. |
| `http/artifacts.router.ts` | Fastify route plugin; maps errors to `401` (no/invalid token), `403` (role not permitted), `404` (artifact not found); sets `Content-Security-Policy: connect-src 'none'` on every served HTML document. |
| `http/html-token-rewriter.ts` | Appends the auth token to every relative `href`/`src` in served HTML, since the browser's own sub-resource requests (`<link>`, `<script>`) never see the query-param token a top-level iframe navigation carries. |

Both `AuthenticationProvider` and `AuthorizationStrategy` are interfaces specifically so new auth methods or authorization rules (ABAC, per-user overrides) can be added without touching the rest of the pipeline.

**Config** (`config.ts`): `PORT` (default `3000`), `ARTIFACTS_ROOT` (default `<project>/artifacts`), `SUPABASE_SERVICE_URL` (default `http://localhost:3335`) — where `supabase-service` lives, since every request now needs a real network round-trip to verify.

**Security note — CSP:** the iframe `sandbox` attribute alone does not restrict outbound network calls (fetch/XHR/WebSocket) from artifact JS, only DOM/storage/navigation. `Content-Security-Policy: connect-src 'none'` on every artifact HTML response is what actually closes that gap — see `artifacts/sandbox-security-test/` for a live artifact that deliberately attempts every attack this is meant to block (localStorage/sessionStorage/cookies, parent-DOM access, external fetch, and direct calls to `supabase-service`/the parent's `/api/data`) and reports whether each was actually blocked.

---

## 3. `services/supabase-service` (port 3335)

The **only** thing in the system that talks to Supabase's data API at request time, and it does so using **only the Supabase anon/publishable key** — never a secret/service-role key. It's also the **only** place in the system that turns a Supabase access token into a trusted identity + app role — every other service (`artifacts-server`) delegates that decision here rather than inspecting the token itself.

**Endpoints:**
```
POST /auth/signup   { email, password }  → creates a Supabase user, returns { accessToken, userId, email }
POST /auth/login    { email, password }  → signs in, returns { accessToken, userId, email }
POST /auth/verify   (Authorization: Bearer <token>)  → { userId, email, role } or 401/403
GET  /data/:table              ?column=value&order=col.asc|desc&limit=n   → { data: [...] }  (list, RLS-scoped)
POST /data/:table   { ...fields }                                          → the created row (bare, not wrapped)
PATCH /data/:table/:id  { ...fields }                                      → the updated row (bare, not wrapped)
DELETE /data/:table/:id                                                    → 204 no body
GET  /health
```
`:table` is schema-agnostic (validated against a plain identifier regex) — this works against any table, not a hardcoded one. In `/data/:table` list requests, every query-string key is treated as an exact-match column filter **except** two reserved keys: `order` (`column.asc` / `column.desc`) and `limit` (row count) — see `data/records.service.ts`.

**How `/auth/verify` works** (`auth/auth.service.ts`):
1. `client.auth.getUser(accessToken)` on an anon client — validates the token is a real, current Supabase session. Anything else (expired, malformed, revoked) → `401`.
2. A **user-scoped** client (the caller's own token attached, not a service-role bypass) reads `SELECT role FROM users WHERE id = <the auth user's id>` — Row-Level Security, not application code, is what actually permits this read. No row → `403`.
3. Returns `{ userId, email, role }`.

Note the `users` table keys directly on the Supabase auth user id (`id` itself, not a separate `authUserId` foreign-key column) and has no `isActive` flag — a matching row is itself treated as "active". This reflects the schema that's actually live in this project's Supabase instance, which is simpler than (and has diverged from) the fuller `authUserId`/`isActive` design sketched in `packages/sql/01_create_tables.sql`.

**Structure:**
- `supabase/supabase-client-factory.ts` — `SupabaseClientFactory`: builds a `@supabase/supabase-js` client scoped to a specific user by attaching `global.headers.Authorization: Bearer <user token>` (not `.auth.setSession()`), always constructed with the anon key
- `auth/auth.service.ts` / `auth.controller.ts` — sign-up/sign-in/verify against Supabase Auth
- `auth/require-supabase-auth.ts` — a Fastify `preHandler` hook requiring a valid `Authorization: Bearer <token>` header on `/data/*` and `/auth/verify`
- `data/records.service.ts` — `RecordsService`: the generic list/create/update/remove proxy described above
- `data/records.controller.ts` — Fastify route plugin wiring the above to HTTP verbs
- `middleware/error-handler.ts` — catch-all error handler registered via `fastify.setErrorHandler`; anything that reaches it gets logged server-side and returned as `{ error: message }` with a real status code, instead of Fastify's default error handler
- `config.ts` — `PORT` (default `3335`), `SUPABASE_URL`, `SUPABASE_ANON_KEY`

**Why no `/schema` endpoint here:** Supabase's own schema/OpenAPI introspection endpoint rejects anon keys outright ("Secret API key required"), which conflicts with this service's anon-key-only design. Schema introspection instead lives in opencode's own `get_schema` tool (§4), which is allowed to hold a secret key because it's never in the runtime request path for artifact data.

---

## 4. `services/agent-service` (port 5002, TypeScript/Fastify)

Takes a natural-language chat prompt and drives [opencode](https://opencode.ai) — run as a subprocess, one invocation per chat turn — to generate or edit the artifact's files directly on disk. There is no intermediate "write artifact" service: opencode has real `read`/`write`/`edit` tools and operates straight against `services/artifacts-server/artifacts/<slug>/`, the same directory `artifacts-server` serves from. This service also owns CRUD for opencode Skills.

**Endpoints:**
```
GET    /agent/providers                          → { default, providers: [{id, label, model}] } — for populating a model picker
POST   /agent/generate-artifact  { prompt, slug?, roles?, provider?, model? }  → one-shot create (thin wrapper around /chat)
POST   /agent/chat  { messages, slug?, roles?, provider?, model? }             → multi-turn create/update, returns updated message history
GET    /agent/skills                             → { skills: [{name, description, content}] }
GET    /agent/skills/{name}                       → one skill, 404 if missing
POST   /agent/skills  { name, description, content }  → create, 201; 409 if the name exists; 400 if invalid
PUT    /agent/skills/{name}  { description, content }  → update, 404 if missing
DELETE /agent/skills/{name}                       → 204, 404 if missing
GET    /health
```

**How a chat turn works** (`src/services/chat-service.ts`):
1. Resolve the artifact's `slug` — the caller's `slug` if editing, otherwise a deterministic slugified form of the first message (`src/services/slug.ts`; no LLM round-trip just to name the folder).
2. Resolve which model opencode should use: `--model anthropic/<model>` or `--model google/<model>`, built from the request's `provider`/`model` (or the `claude`/`gemini` defaults) — see `PROVIDER_MODEL_PREFIX` in `src/config.ts`. Provider *credentials* are opencode's own concern (`opencode auth login`, or `ANTHROPIC_API_KEY`/`GEMINI_API_KEY` inherited from this process's environment), not something this service holds.
3. Run opencode (`src/services/opencode-runner.ts`): `opencode run --dir <artifact_dir> --format json --model <model> [--session <id>] "<prompt>"` as a subprocess (via `cross-spawn`, with its stdin explicitly closed rather than left as an open pipe — otherwise opencode blocks waiting to read it), parsing its newline-delimited JSON event stream for the final assistant text (the `reply`) and its session id. A session id is cached per slug (in-memory) so a follow-up edit continues the same opencode session instead of re-discovering the directory from scratch; when there's no session to continue, the full message transcript is reconstructed into the prompt instead of just the latest message, so context is never silently lost. `OPENCODE_TIMEOUT_SECONDS` (default `900`) bounds how long a single turn can run — a large multi-screen artifact can legitimately take several minutes.
4. Write `manifest.json` directly (`src/services/manifest.ts`) — the roles/title convention artifacts-server's catalog and authorization depend on. opencode never touches this file itself (see `AGENTS.md` below); this service does it after a successful run, so a failed/partial opencode run never leaves a manifest for broken content.
5. Enumerate whatever files actually changed on disk (excluding `manifest.json`) to report `files_written` — no separate service call needed since this process already has the artifacts-root filesystem.

opencode itself gets its capabilities from files under `services/artifacts-server/artifacts/`, discovered automatically by walking up from the artifact's own directory (this is opencode's own built-in behavior, not something this service implements):
- **`AGENTS.md`** — the three-file artifact shape (`index.html`, `assets/style.css`, `assets/app.js`), no `<form>`/`type="submit"` (sandboxed without `allow-forms`), no external libraries/CDNs, Tailwind usage (link `../_shared/tailwind.min.css` before `assets/style.css`), the exact `postMessage` data-bridge wire protocol artifacts must use for persisted data (mirrors `useArtifactDataBridge.ts`, §5), and an instruction to never touch `manifest.json`. Always in context, every turn.
- **`.opencode/tool/get_schema.ts`** — a custom opencode tool that calls Supabase's `GET /rest/v1/` with `Accept: application/openapi+json` **using the secret key**, reporting real table/column names, nullability, enum-typed columns' exact allowed values (PostgREST includes these inline in the OpenAPI document — no extra RPC needed), and — via a `get_table_constraints` SECURITY DEFINER RPC (`services/supabase-service/sql/003_create_table_constraints_rpc.sql`) — primary/foreign/unique/CHECK constraints. Invoked as a tool call, on demand, not always in context.
- **`.opencode/skills/*/SKILL.md`** — reusable, named procedures (e.g. "our house style for a CRUD form", "how to detect the current user's role correctly"), each with a `name` + `description` frontmatter and a markdown body. Every skill's `name`+`description` is always in context (cheap — just a menu of what's available); a skill's full body is only loaded when opencode actually decides to use it, via its built-in `skill` tool call. The chat UI can name a skill explicitly in the message text to make that decision reliable rather than left to the model's own judgment (see `ChatPage.tsx`, §5) — but opencode can and does pick a relevant skill up from wording alone too. Managed via the `/agent/skills` endpoints above, which write/read/delete `SKILL.md` files directly (`src/services/skill-service.ts`) — no YAML dependency, since the format is just two string fields in a small hand-rolled frontmatter parser.

**Config** (`src/config.ts`): `PORT` (default `5002`), `ARTIFACTS_SERVER_URL`, `ARTIFACTS_ROOT` (default `../artifacts-server/artifacts`), `OPENCODE_BIN` (default `opencode`, resolved via `PATH`), `OPENCODE_TIMEOUT_SECONDS` (default `900`), `LLM_PROVIDER`/`ANTHROPIC_MODEL`/`GEMINI_MODEL` (default model choices), plus `SUPABASE_URL`/`SUPABASE_SECRET_KEY` — needed here (not in a separate service) because the opencode subprocess inherits this process's environment, and that's what its `get_schema` tool reads.

**Why the secret key is safe here:** `get_schema` is only ever invoked by opencode at artifact-*generation* time, server-side, to look up real table/column names before writing code — it is never in the path of a running artifact's data requests (those go through `supabase-service`, anon-key-only, RLS-scoped). No artifact, and no browser code, ever sees this key or this endpoint.

---

## 5. `apps/artifacts-viewer` (port 4200)

A Next.js (App Router) app. There's no role picker anywhere — a user logs in with real Supabase credentials, and their role is whatever `supabase-service` reports for their account. The artifact list, the sidebar, and the chat page all just reflect that.

**Artifact rendering flow:**
1. The user logs in via `SupabaseSessionWidget.tsx` (`POST /api/supabase/login`, a BFF route to `supabase-service`'s `/auth/login`). The resulting `{ accessToken, userId, email }` is held in React state (`supabase-session-context.tsx`), never in `localStorage`/cookies.
2. That same Supabase access token is what's used everywhere a token is needed — there is no separate token-minting step. `useArtifactCatalog.ts` calls this app's own `GET /api/artifacts` with `Authorization: Bearer <token>`, which forwards to `artifacts-server`'s `GET /api/artifacts` (`lib/api/artifacts-catalog-client.ts`); the response includes both the visible artifacts **and** the caller's resolved `role`, straight from `artifacts-server`'s own verification — the frontend never computes or stores a role independently.
3. `useArtifactSrc.ts` builds `http://localhost:3000/<artifact-path>/?token=<the same Supabase access token>` and sets it as the iframe `src` (a query param, not a header, because a plain iframe navigation can't attach `Authorization`).
4. `artifacts-server` verifies that token via `supabase-service` and checks the resolved role against the manifest exactly as described in §2, and returns the artifact — or a JSON error, which just renders as text inside the frame.

**Persisted-data flow (the `postMessage` bridge)** — unchanged in shape from the token flow above, just now built entirely on the one real Supabase session:
1. The artifact's JS posts `{ source: 'artifact-data-bridge', type: 'request', requestId, table, method, id, body, search }` to `window.parent` — it holds no credentials and cannot reach any backend on its own (sandboxed, no `allow-same-origin`, and `connect-src 'none'` blocks any outbound call it might attempt anyway).
2. `useArtifactDataBridge.ts` validates the sender via `event.source === iframe.contentWindow` (**not** `event.origin`, since a sandboxed iframe's origin is the opaque string `"null"`), then makes the real request itself — `fetch('/api/data/<table>[/<id>][?search]', { headers: { Authorization: Bearer <supabase token>, X-User-Id } })` — using the logged-in user's own session.
3. `app/api/data/[table]/route.ts` and `[id]/route.ts` are a thin BFF proxy to `supabase-service`'s `/data/:table` endpoints (no CORS — deliberately, as defense-in-depth against any artifact that somehow tried to call them directly).
4. The result is posted back to the iframe as `{ source: 'artifact-data-bridge', type: 'response', requestId, status, body }`.

**Modules:**
- `lib/config/env.ts` — `getArtifactsServerUrl()` (public — the browser needs it to build the iframe `src`), `getAgentServiceUrl()`, `getSupabaseServiceUrl()` (server-only)
- `lib/api/supabase-service-client.ts`, `lib/api/agent-service-client.ts`, `lib/api/artifacts-catalog-client.ts` — server-only (`import 'server-only'`) clients for each backend; `lib/api/catalog-client.ts`, `chat-client.ts`, `skills-client.ts` — matching browser-side clients that call this app's own BFF routes
- `app/api/supabase/{login,signup}/route.ts`, `app/api/data/[table]/{route.ts,[id]/route.ts}`, `app/api/artifacts/route.ts`, `app/api/chat/{route.ts,providers/route.ts}`, `app/api/skills/{route.ts,[name]/route.ts}` — the BFF routes bridging browser ↔ each backend (there is no `/api/token` route anymore)
- `lib/supabase/supabase-session-context.tsx` — React context holding the Supabase session, plus `login`/`signUp`/`logout`
- `hooks/useArtifactDataBridge.ts` — the postMessage mediator described above
- `hooks/useArtifactCatalog.ts`, `hooks/useArtifactSrc.ts` — fetches the role-scoped catalog and builds the iframe `src`, both keyed on the Supabase access token directly
- `components/ArtifactSelector.tsx` (a sidebar list of pages, not a dropdown), `ArtifactFrame.tsx` (accepts a `reloadNonce` prop to force a remount/reload independent of `src`), `ArtifactViewer.tsx`, `components/supabase/ProfileMenu.tsx` + `SupabaseSessionWidget.tsx` (email/role/logout, opens as a popup from a profile chip — no `RoleSwitcher`, roles are never user-selectable) — composed in `app/page.tsx`

**Iframe sandboxing** (`ArtifactFrame.tsx`) — artifacts are treated as untrusted, potentially AI-generated (and thus potentially adversarial) content:
- `sandbox="allow-scripts"` **only** — no `allow-same-origin` (the framed document gets a unique opaque origin, so it can't read this app's — or even its own origin's — cookies/storage), no forms, popups, top-navigation, downloads, or modals.
- No `allow` (Permissions Policy) features are delegated.
- `referrerPolicy="no-referrer"` — this app's URL is never sent to the artifacts server as a `Referer` header.
- The iframe is keyed by `src` plus a `reloadNonce` counter, so switching artifact — or an explicit "⟳ Refresh" click, or a new chat response landing — fully remounts it rather than reusing stale state, even when the URL string itself hasn't changed.
- `artifacts-server` additionally sends `Content-Security-Policy: connect-src 'none'` on every artifact document, so even outbound network calls the sandbox attribute itself doesn't restrict are blocked at the browser level.

### AI chat page (`/chat`)

Lets a user create or update an artifact by chatting instead of hand-writing HTML, and manage opencode Skills without leaving the page.

- `app/chat/page.tsx` → `components/chat/ChatPage.tsx` — owns the conversation state (`messages`, the target `slug`, selected `provider`, selected skills, the live preview pane)
- `components/chat/ChatMessageList.tsx`, `ChatComposer.tsx`, `ProviderSelector.tsx`, `ExistingArtifactsPanel.tsx` — presentational pieces for the conversation and artifact-switching
- `components/chat/SkillSelector.tsx` — a row of toggleable chips, one per skill; selections persist across turns until toggled off
- `components/chat/SkillsPanel.tsx` — inline create/edit/delete UI for skills, calling `/api/skills`; toggled in place of `ExistingArtifactsPanel` by a header button
- `lib/chat/types.ts`, `lib/skills/types.ts` — the wire types shared between the proxies and the UI

**Flow:** composer submits → if any skills are selected, the message is rewritten to `Use these skills: "a", "b". <original text>` (visible in the transcript — no hidden text) → optimistic user message appended → `POST /api/chat` with the full message list, the current `slug` (`null` on the first turn), and the selected provider → `agent-service` returns the assistant's reply plus the artifact's `url_path` → the page adopts the returned `slug`/`url_path` so the *next* message updates the same artifact instead of creating a new one, and the preview pane's iframe reloads against it (both automatically, after every response, and on demand via the refresh button).

---

## Security model summary

| Concern | Mechanism |
|---|---|
| Artifact can't read parent cookies/storage/DOM | `sandbox="allow-scripts"` with no `allow-same-origin` → opaque origin |
| Artifact can't submit forms / navigate top / open popups | No `allow-forms`/`allow-top-navigation`/`allow-popups` on the sandbox attribute |
| Artifact can't make its own network calls (external or internal) | `Content-Security-Policy: connect-src 'none'` on every artifact HTML response |
| Artifact can't hold or leak a real Supabase/database credential | It never receives one — all data access goes through `postMessage` → `useArtifactDataBridge.ts`, which holds the session and makes the request itself |
| A forged/spoofed `postMessage` sender | Validated via `event.source === iframe.contentWindow`, not `event.origin` (which is `"null"` for a sandboxed frame either way) |
| Row-level authorization on actual data | Postgres RLS policies (`auth.uid() = id`, etc.) — enforced by Supabase itself against the user's own token, not application code |
| Runtime Supabase access is over-privileged | `supabase-service` uses **only** the anon key, always scoped to the calling user's token (`global.headers.Authorization`) |
| A caller's role can't be forged by decoding/trusting the token client-side | `artifacts-server` never inspects the token itself — it always asks `supabase-service`'s `/auth/verify`, the one place that resolves a token to a role via an RLS-scoped DB read |
| Schema introspection needs a secret key Supabase requires for that endpoint | Isolated to opencode's own `get_schema` tool — generation-time only, never in any runtime artifact/data request path |
| AI-generated code doesn't know the real schema | The `get_schema` tool fetches real table/column/constraint/enum names before code is written |

`services/artifacts-server/artifacts/sandbox-security-test/` is a live artifact that exercises every row in this table (except the RLS/schema ones, which aren't reachable from an artifact by design) and reports pass/fail for each — open it any time to re-verify the sandbox after changing anything here.

---

## Running everything locally

See the top-level [README.md](./README.md) for step-by-step setup and run instructions, including which `.env` files need which keys.

## Status

Everything above is implemented, builds, typechecks, and lints. Verified end-to-end live against a real Supabase project: signup/login → `/auth/verify` resolving the real role from the `users` table → role-based 200/403/404 responses from `artifacts-server` → sandboxed rendering; the full agent-service → opencode → artifacts-server chain (both creating a new artifact and editing an existing one across turns, including a confirmed session-continuity bug fix — resending full history on top of a live opencode session confused the model into re-validating the original request instead of applying the newest one); the postMessage data bridge performing real CRUD against Supabase through RLS; `get_schema` returning the real database schema, including enum-typed columns' exact allowed values, via the secret key held only by opencode's tool; a Skill created through `/agent/skills` being genuinely discovered and invoked by opencode mid-generation (confirmed via its tool-call event stream, not just that the file was theoretically visible); the CSP blocking external/internal fetches from inside the sandboxed iframe. Not yet built: an artifact publishing/upload flow beyond the agent, and e2e test suites (removed from this workspace for now).
