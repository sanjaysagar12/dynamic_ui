# Dynamic UI — Architecture Overview

This Nx workspace implements an **Artifacts platform**: a static-file server that serves role-gated "artifacts" (self-contained HTML/CSS/JS bundles) similarly to Apache, a Prisma-backed tool-call layer that holds the only database credential in the system and is also the sole authority on "who is this caller and what role do they have", an artifact agent that drives [opencode](https://opencode.ai) to generate and update artifacts (and their reusable Skills) from a chat prompt, a database agent that answers natural-language questions about the data by calling the same named tools everything else does, and a Next.js viewer that renders artifacts in a sandboxed iframe, mediates their data access over `postMessage`, and hosts both chat experiences.

Identity is a JWT minted by `tool-service` itself — there is no external auth provider. A user registers/logs in once against `tool-service`'s own `login`/`register` tools; every other service that needs to know who they are (and what role they have) asks `tool-service`'s `POST /auth/verify`, never decodes anything itself.

```
apps/
  artifacts-viewer/     Next.js app — Artifact Chat + Database Chat pages, sandboxed iframe viewer + postMessage
                          data bridge (port 4200)
services/
  artifacts-server/     Fastify app — serves artifacts, verifies the caller via tool-service + a locked-down CSP (port 3400)
                          artifacts/.opencode/tool/get_tools.ts, artifacts/.opencode/skills/*/SKILL.md, and
                          artifacts/AGENTS.md — opencode's project-local tool-catalog lookup, reusable Skills, and
                          artifact-authoring instructions, shared by every artifact directory underneath
  tool-service/          Fastify + Prisma app — the only place holding a database credential; exposes a generic
                          GET /tools + POST /tools/:name/execute tool-call layer, with login/register/whoami as
                          plain tools rather than a separate auth API (port 5104)
  artifact-agent-service/ TypeScript/Fastify app — turns a chat prompt into an artifact by shelling out to opencode,
                          and owns CRUD for opencode Skills (port 5102); endpoint: POST /agent/chat-artifact
  db-agent-service/      TypeScript/Fastify app — answers natural-language questions about the data (and performs
                          confirmed writes) by calling whatever tools tool-service's catalog currently offers,
                          under the caller's own tool-service JWT (port 5103); endpoint: POST /agent/chat-db
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

`roles.ts` is a plain TypeScript module — no JSON import-attribute machinery, no filesystem reads at runtime — which keeps this package safe to bundle directly into browser code (no Node-only APIs), which matters because `apps/artifacts-viewer`'s client components import `Role`/`ROLES` directly. Token minting and verification themselves live in `tool-service` (`src/auth/jwt.ts`'s `signToken`/`verifyToken`) rather than here — this package only carries the role vocabulary both sides need to agree on.

---

## 2. `services/artifacts-server` (port 3400)

Serves artifacts from disk the way Apache serves static files — folder structure maps directly to URL structure — but every artifact is gated by a **verified `tool-service` identity** + a per-artifact `manifest.json` declaring which roles may view it.

**Artifact folder layout** (lives at `services/artifacts-server/artifacts/`):
```
artifacts/
  AGENTS.md             opencode's artifact-authoring rules — shared by every artifact directory below
  .opencode/
    tool/get_tools.ts   opencode's tool-service catalog lookup
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
| `auth/authentication-provider.ts` + `tool-service-authentication-provider.ts` | `AuthenticationProvider` interface (`authenticate(req): Promise<AuthContext \| null>`) with a `ToolServiceAuthenticationProvider` implementation — reads a Bearer header **or** a `?token=` query param (iframe `src` navigations can't set headers), then forwards that token to `tool-service`'s `POST /auth/verify` over HTTP. It never decodes or trusts the token itself; a failed/invalid/missing token, a `tool-service` network failure, or a malformed response all resolve to `null` alike. |
| `authorization/authorization-strategy.ts` + `role-authorization-strategy.ts` | `AuthorizationStrategy` interface; the current implementation checks the verified role against `manifest.roles`. |
| `service/artifact-service.ts` | Orchestrates resolve → load manifest → authenticate (awaits the HTTP round-trip) → authorize. |
| `service/artifact-catalog.service.ts` | Walks the artifacts tree for the public catalog (`GET /api/artifacts`), skipping any path segment starting with `_`. Also the only place that renames (`rename(slug, title)`, rewriting `manifest.json`'s `title`) or deletes (`remove(slug)`) an artifact, backing `PATCH`/`DELETE /api/artifacts/*` — both re-run the same walk and only ever act on a directory that walk itself already recognized as a real manifest-bearing artifact, so a slug can't be used to reach an arbitrary path the way `artifact-path-resolver.ts`'s more permissive sub-path resolution can for serving. |
| `http/artifacts.router.ts` | Fastify route plugin; maps errors to `401` (no/invalid token), `403` (role not permitted), `404` (artifact not found); sets `Content-Security-Policy: connect-src 'none'` on every served HTML document. |
| `http/html-token-rewriter.ts` | Appends the auth token to every relative `href`/`src` in served HTML, since the browser's own sub-resource requests (`<link>`, `<script>`) never see the query-param token a top-level iframe navigation carries. |

Both `AuthenticationProvider` and `AuthorizationStrategy` are interfaces specifically so new auth methods or authorization rules (ABAC, per-user overrides) can be added without touching the rest of the pipeline.

`PATCH`/`DELETE /api/artifacts/*` (`http/artifacts-catalog.router.ts`, alongside `GET /api/artifacts`) are gated differently from everything else here: both are a flat "is this caller OWNER" check on `AuthContext.role`, not `RoleAuthorizationStrategy`'s per-artifact `manifest.roles` check — renaming/deleting isn't scoped to which roles can *see* an artifact, only to the one role trusted to manage any of them. These are the only write paths `artifacts-server` has, and both are metadata/filesystem-level only; artifact *content* is still only ever created/edited by `artifact-agent-service` shelling out to opencode.

**Config** (`config.ts`): `PORT` (default `3400` — chosen to avoid the common `3000` collision with other services on a shared host), `ARTIFACTS_ROOT` (default `<project>/artifacts`), `TOOL_SERVICE_URL` (default `http://localhost:5104`) — where `tool-service` lives, since every request now needs a real network round-trip to verify.

**Security note — CSP:** the iframe `sandbox` attribute alone does not restrict outbound network calls (fetch/XHR/WebSocket) from artifact JS, only DOM/storage/navigation. `Content-Security-Policy: connect-src 'none'` on every artifact HTML response is what actually closes that gap — see `artifacts/sandbox-security-test/` for a live artifact that deliberately attempts every attack this is meant to block (localStorage/sessionStorage/cookies, parent-DOM access, external fetch, and a direct call to `tool-service`/the parent's `/api/tools`) and reports whether each was actually blocked.

---

## 3. `services/tool-service` (port 5104)

The **only** thing in the system holding a database credential (a single Prisma `DATABASE_URL`), and the **only** place that turns a caller's bearer token into a trusted identity + role — every other service (`artifacts-server`, `db-agent-service`) delegates that decision here rather than inspecting the token itself.

**Endpoints:**
```
GET  /tools                          → { tools: [{ name, description, inputSchema, mutates, destructive, requiredRoles }] }
POST /tools/:name/execute  { args, confirmed? }  (Authorization: Bearer <token>, unless the tool doesn't require auth)
                                      → 200 { ok: true, data } | { ok: false, error, code }
                                        401 unauthenticated · 403 forbidden role · 404 unknown tool
                                        409 a mutating call missing confirmed: true
POST /auth/verify   (Authorization: Bearer <token>)  → { userId, email, role } or 401
GET  /health
```
`GET /tools` needs no auth and returns the same catalog to everyone — it's metadata (name, description, a Zod-derived JSON Schema for its arguments, whether it mutates/is destructive, and which roles may call it), not data. `POST /auth/verify` is deliberately a plain Fastify route, not a tool — it exists purely so other services have a stable, tool-registry-independent identity check to call.

**Identity: JWTs minted by ordinary tools, not a separate auth service** (`src/auth/jwt.ts`, `src/tools/plugins/register.ts`, `login.ts`): `register` and `login` are tools like any other (`requiresAuth: false`, so `POST /tools/register/execute` and `POST /tools/login/execute` work with no bearer token), except their handler calls `signToken({ sub, email, role }, JWT_SECRET)` and returns `{ accessToken, userId, email, role }`. The token is a plain `jsonwebtoken`-signed JWT (7-day expiry) — `tool-service` is the only process holding `JWT_SECRET`, so it's the only one that can mint or verify one; every other service treats it as opaque and asks `/auth/verify`. `register` defaults a new account to the least-privileged role (`STOREKEEPER`) unless the caller supplies a known role from `@org/shared-auth`'s `isRole()`.

**The plugin tool registry** (`src/tools/registry.ts`, `src/tools/types.ts`): a `ToolDefinition` is `{ name, description, inputSchema (Zod), requiresAuth?, requiredRoles?, mutates, destructive?, handler(ctx, args) }`. Every plugin file under `src/tools/plugins/` is imported explicitly into a fixed `ALL_PLUGINS` array in `registry.ts` — not discovered via a runtime directory scan — because the `serve`/`build` targets bundle the whole app into one `dist/main.js` via webpack, where `fs.readdirSync` against the plugins folder would silently find nothing at runtime even though it appears to work under a dev-time loader. A second file, `tools.enabled.json`, is a flat array of names that gates which of the registered plugins are actually reachable, independent of whether they're implemented — a way to ship a tool disabled before it's ready for use. Adding a new tool means: write the plugin file, add it to `ALL_PLUGINS`, add its name to `tools.enabled.json`.

`POST /tools/:name/execute` (`src/http/tools.router.ts`) is the one HTTP entrypoint every tool goes through:
1. 404 if the name isn't in the enabled registry.
2. If `requiresAuth !== false`, verify the `Authorization: Bearer` header the same way `/auth/verify` does — invalid/missing → `401`. If the resolved role isn't in `requiredRoles` (when the tool sets any) → `403`.
3. Validate `body.args` against the tool's own Zod `inputSchema` — `400` on failure.
4. If `mutates` is true, require `body.confirmed === true` — `409` otherwise. This is a request-shape gate enforced centrally, once, rather than each mutating handler re-implementing its own confirmation check.
5. Call the handler with `{ userId, email, role, prisma }` and the parsed args; whatever it returns (`{ ok: true, data }` or `{ ok: false, error, code }`) is sent back as-is with `200`.

**Authorization moved from Postgres RLS into this per-tool gate, deliberately.** The previous design (`supabase-service`, removed in this phase) used Supabase Row-Level Security as the actual authorization boundary — every read/write ran as the calling user's own Postgres role, and RLS policies decided what came back. `tool-service` instead holds one shared database credential for every caller, and each tool's own `requiredRoles` (checked centrally in `tools.router.ts`, so a tool can't forget it) plus whatever the handler itself does is what decides what's allowed. This trade was made because the write-heavy tools here (`create_material`, `update_material`, `deactivate_material`, …) need business-rule validation that doesn't reduce to a row-visibility predicate — see `withAuditedTransaction` below and `deactivate_material`'s "requires zero stock on hand" check — which is much more naturally expressed as ordinary application code than as SQL policies, and a single Prisma connection means one place (this service) to audit for correctness instead of a second, parallel policy language living in Postgres. The read side (`list_rows`) is honest about where this trade currently stands short of RLS's per-row guarantee: it accepts a `table` name and an arbitrary `where` and returns whatever Prisma finds, with no caller-based scoping yet — its own source comment flags this explicitly as unaudited (`// TODO(phase-2): audit and add per-table ownership scoping`), and no shipped plugin currently sets `requiredRoles` to anything narrower than "any authenticated caller." The mechanism (a `requiredRoles` array checked before a handler ever runs) exists and is enforced; using it more granularly, table-by-table, is tracked follow-up work, not a gap in the framework itself.

**Auditing writes** (`src/lib/withAuditedTransaction.ts`): a mutating tool that wants an audit trail wraps its Prisma writes in `withAuditedTransaction(ctx, fn, buildMeta)`, which runs `fn` and one `AuditEvent` insert (`entityType`, `entityId`, `action`, `toolName`, before/after JSON, `actorType: ctx.userId ? 'HUMAN' : 'AGENT'`, `actorId`) inside the same database transaction — if either the write or the audit insert fails, both roll back together, so there's no code path that produces an unaudited write. `create_material`/`update_material`/`deactivate_material` all use it.

**Current tool catalog** (`src/tools/plugins/`, all listed in `tools.enabled.json`): `register`/`login` (identity, `requiresAuth: false`), `whoami` (returns the caller's own `{ userId, email, role }`), `list_rows` (generic `findMany` by table name, unscoped — see above), `search_materials` (name substring search), `create_material`/`update_material`/`deactivate_material` (material master CRUD — deactivate rather than delete, and only once stock is zero), `get_material_balance` (reads the derived `StockBalance` row for one or more materials). The underlying schema (`prisma/schema.prisma`) is a much larger inventory/ERP design (jobs, purchase orders, goods receipts, stock counts, scrap sales, an append-only `StockMovement` ledger with a derived `StockBalance`) than what's exposed as tools today — only the material-master slice is wired up so far; the rest of the schema exists ahead of the tools that will operate on it.

**Config** (`src/config.ts`): `PORT` (default `5104`), `DATABASE_URL`/`DIRECT_URL` (Prisma's pooled + direct Postgres connection strings — the only database credential anywhere in this system), `JWT_SECRET` (signs and verifies every access token; held only here).

---

## 4. `services/artifact-agent-service` (port 5102, TypeScript/Fastify)

Takes a natural-language chat prompt and drives [opencode](https://opencode.ai) — run as a subprocess, one invocation per chat turn — to generate or edit the artifact's files directly on disk. There is no intermediate "write artifact" service: opencode has real `read`/`write`/`edit` tools and operates straight against `services/artifacts-server/artifacts/<slug>/`, the same directory `artifacts-server` serves from. This service also owns CRUD for opencode Skills.

**Endpoints:**
```
GET    /agent/providers                          → { default, providers: [{id, label, model}] } — for populating a model picker
POST   /agent/generate-artifact  { prompt, slug?, roles?, provider?, model? }  → one-shot create (thin wrapper around /chat-artifact)
POST   /agent/chat-artifact  { messages, slug?, roles?, provider?, model? }    → multi-turn create/update, returns updated message history
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
- **`AGENTS.md`** — the three-file artifact shape (`index.html`, `assets/style.css`, `assets/app.js`), no `<form>`/`type="submit"` (sandboxed without `allow-forms`), no external libraries/CDNs, Tailwind usage (link `../_shared/tailwind.min.css` before `assets/style.css`), the exact `postMessage` data-bridge wire protocol artifacts must use for persisted data (mirrors `useArtifactDataBridge.ts`, §6), and an instruction to never touch `manifest.json`. Always in context, every turn.
- **`.opencode/tool/get_tools.ts`** — a custom opencode tool that calls `tool-service`'s `GET /tools` (no key required — the catalog itself is public metadata) and formats every tool's name, description, argument JSON Schema, mutate/destructive flags, and required roles, so generated code calls real tools with real argument shapes instead of inventing table/endpoint names. This replaces an earlier `get_schema.ts` tool that queried Supabase's schema-introspection endpoint directly with a secret key — that direct-database-access model is gone along with `supabase-service`; artifacts (and the code opencode writes for them) now only ever know about the same fixed tool catalog every other caller sees, nothing more. Invoked as a tool call, on demand, not always in context.
- **`.opencode/skills/*/SKILL.md`** — reusable, named procedures (e.g. "our house style for a CRUD form", "how to detect the current user's role correctly"), each with a `name` + `description` frontmatter and a markdown body. Every skill's `name`+`description` is always in context (cheap — just a menu of what's available); a skill's full body is only loaded when opencode actually decides to use it, via its built-in `skill` tool call. The chat UI can name a skill explicitly in the message text to make that decision reliable rather than left to the model's own judgment (see `ChatPage.tsx`, §6) — but opencode can and does pick a relevant skill up from wording alone too. Managed via the `/agent/skills` endpoints above, which write/read/delete `SKILL.md` files directly (`src/services/skill-service.ts`) — no YAML dependency, since the format is just two string fields in a small hand-rolled frontmatter parser.

**Config** (`src/config.ts`): `PORT` (default `5102` — chosen to avoid a `5002` collision with another service on a shared host), `ARTIFACTS_SERVER_URL`, `ARTIFACTS_ROOT` (default `../artifacts-server/artifacts`), `OPENCODE_BIN` (default `opencode`, resolved via `PATH`), `OPENCODE_TIMEOUT_SECONDS` (default `900`), `LLM_PROVIDER`/`ANTHROPIC_MODEL`/`GEMINI_MODEL` (default model choices), plus `TOOL_SERVICE_URL` — read by the `get_tools` opencode tool (inherited into the opencode subprocess's environment), defaulting to `http://localhost:5104` if unset. This service holds no database credential of its own, generation-time or otherwise — it never did anything but proxy opencode's own subprocess to the filesystem, and now opencode's only outbound network dependency for data-shape knowledge is `tool-service`'s open, metadata-only `GET /tools`.

---

## 5. `services/db-agent-service` (port 5103, TypeScript/Fastify)

Answers natural-language questions about the data itself — "how many materials do we have?", "what's the stock balance on material X?" — and can perform confirmed writes, by calling whatever tools `tool-service`'s catalog currently exposes. It holds no database credential of any kind and no tool-specific knowledge of its own; every read and write goes through a named tool under the caller's own `tool-service` JWT, so that tool's own `requiredRoles` check and its handler's own logic — not this agent's judgment — decide what's actually allowed.

**Endpoint:**
```
POST /agent/chat-db     { messages, jwt, model? }  → { type: 'text', content, messages }
GET  /health
```
`jwt` is the caller's own `tool-service` access token, forwarded as-is on every tool call this turn makes — this service never decodes it and holds no `tool-service` credential of its own.

**How a chat turn works** (`src/services/db-chat-service.ts`, `src/services/tool-service-client.ts`):
1. `ToolServiceClient.fetchToolCatalog()` calls `tool-service`'s `GET /tools` — cached process-wide for `DB_AGENT_TOOL_CATALOG_CACHE_TTL_SECONDS` (default 300s), since the catalog is caller-independent. Each entry is translated into an Anthropic tool definition: its own `inputSchema` becomes the tool's `input_schema`, and if the tool `mutates`, a `confirmed: boolean` property is synthesized on top (tool-service's own schema never includes one — it's a sibling field on the execute request, not part of `args`) so the model can set it itself. A mutating tool's description also gets an appended instruction: don't call it with `confirmed: true` until a *previous* turn has already explained the exact change in plain text and the user has explicitly agreed to it in a later message.
2. The full message history, that tool list, and a system prompt (which tells the model to read each tool's own description/schema rather than assume anything, and never speculate about *why* a read came back empty or a write was rejected — see `tool-guidance.ts`) go to Claude (`@anthropic-ai/sdk`, called directly — no opencode involved).
3. Every tool call the model makes is dispatched generically (`runTool` — no per-tool-name branch): a mutating call without `confirmed: true` is rejected as a tool error without ever reaching `tool-service`; otherwise `ToolServiceClient.executeTool(jwt, name, args, confirmed)` calls `POST /tools/:name/execute` on `tool-service` with the caller's own JWT. A handler-level `{ ok: false, ... }` result is fed back to the model as an ordinary tool result (so it can report the problem honestly); only a genuine transport/auth failure is a tool-use error, and a `401` from `tool-service` aborts the whole turn (mapped to this route's own `401`) rather than becoming something the model tries to route around.
4. The loop runs for up to `DB_AGENT_MAX_TOOL_ITERATIONS` (default 6) rounds; the final round offers no tools at all, forcing a plain-text answer instead of another round-trip.
5. The assistant's final text is the response's `content`, appended to the outward message history — no server-side session state between turns, since each turn resends the full transcript.

**Every write still requires the user's explicit confirmation before it happens — enforced structurally, not just by prompt discipline.** A mutating tool's Anthropic-facing schema requires `confirmed`, its description instructs the model to have already explained the change and gotten agreement in a *prior* turn, and `runTool` refuses to forward the call to `tool-service` at all unless `confirmed === true` was actually set — a model that "forgets" to ask is blocked at this dispatch step, and `tool-service`'s own `409` (missing `confirmed: true` on a mutating tool, §3) is a second, independent backstop below that. This replaces an earlier design (`write_table`/`request_form`/schema-driven forms, built against `supabase-service`'s direct Postgres access) with something generic over whatever tools exist — there's no longer a hand-authored form-building step, because a tool's own `inputSchema` already is the argument contract; the model asks for confirmed values the same way it asks for any other tool argument, guided by the tool's description.

**RLS-empty vs. real errors, restated generically** (`tool-guidance.ts`): a tool may scope its own results to what the caller is allowed to see or change (§3's `list_rows` caveat aside, individual handlers like the material tools apply their own validation). An empty or missing read result and a "caller isn't permitted" result are indistinguishable to the model and **must** be treated identically in its answer — the system prompt forbids speculating about which one happened, the same rule the old RLS-based design enforced, just framed around "a tool may scope its results" instead of naming Postgres RLS specifically, since `tool-service` has no RLS layer at all.

**Config** (`src/config.ts`): `PORT` (default `5103` — chosen to avoid a `5003` collision with another service on a shared host), `TOOL_SERVICE_URL` (default `http://localhost:5104`), `ANTHROPIC_API_KEY` (the only credential this service holds — authenticates it to Anthropic, never to `tool-service`), `DB_AGENT_MODEL` (default `claude-sonnet-5`), `DB_AGENT_MAX_TOOL_ITERATIONS` (default `6`), `DB_AGENT_TOOL_CATALOG_CACHE_TTL_SECONDS` (default `300`).

---

## 6. `apps/artifacts-viewer` (port 4200)

A Next.js (App Router) app. There's no role picker anywhere — a user logs in with real `tool-service` credentials, and their role is whatever the JWT's `/auth/verify` resolution reports. The artifact list, the sidebar, and both chat pages all just reflect that.

**Login/registration:** `tool-service` has no external auth provider or hosted signup page of its own, so this app owns that UI directly — `components/auth/AuthWidget.tsx` is a small popup (toggle between Sign in / Register) rendered wherever `ProfileMenu` used to assume an already-external session existed. It calls this app's own `POST /api/tools/login` / `POST /api/tools/register` (`app/api/tools/login/route.ts`, `.../register/route.ts`), which forward to `tool-service`'s unauthenticated `login`/`register` tools (`lib/api/tool-service-client.ts`'s `toolServiceLogin`/`toolServiceRegister` — `register` is called with `confirmed: true` baked in, since submitting the registration form *is* the user's confirmation, unlike a data-bridge write that gets its own separate confirm step). The resulting `{ accessToken, userId, email, role }` is held in React state (`lib/session/session-context.tsx`'s `SessionProvider`/`useSession`), never in `localStorage`/cookies.

**Artifact rendering flow:**
1. `useArtifactCatalog.ts` calls this app's own `GET /api/artifacts` with `Authorization: Bearer <token>`, which forwards to `artifacts-server`'s `GET /api/artifacts` (`lib/api/artifacts-catalog-client.ts`); the response includes both the visible artifacts **and** the caller's resolved `role`, straight from `artifacts-server`'s own verification — the frontend never computes or stores a role independently.
2. `useArtifactSrc.ts` → `buildArtifactUrl()` builds `/api/artifact-proxy/<artifact-path>/index.html?token=<the same access token>` — a same-origin, relative URL, **not** a direct link to `artifacts-server` — and sets it as the iframe `src` (a query param, not a header, because a plain iframe navigation can't attach `Authorization`). Explicitly naming `index.html` (rather than a bare directory path ending in `/`) is deliberate: Next.js's own routing strips a trailing slash via redirect before this route ever runs (`trailingSlash: false`, the default), which would otherwise land the iframe's committed document URL one path segment short of where the artifact's relative asset hrefs expect it to be. Naming the file explicitly sidesteps that — no trailing slash for Next to strip, and artifacts-server serves it directly with no redirect of its own either (`artifact-path-resolver.ts` only redirects when a *directory* is requested without a slash).
3. `app/api/artifact-proxy/[...path]/route.ts` forwards that request server-side to `artifacts-server` (`getArtifactsServerUrl()`), streaming the response straight back — status, body, and specifically the `Content-Security-Policy` header artifacts-server sets on HTML responses (§2), since that header is a real security control the browser must actually receive, not just an implementation detail safe to drop. `artifacts-server` verifies the token via `tool-service` and checks the resolved role against the manifest exactly as described in §2, and returns the artifact — or a JSON error, which just renders as text inside the frame.
4. Every relative `href`/`src` artifacts-server's own `html-token-rewriter.ts` rewrites into the artifact's HTML (`assets/app.js`, `../_shared/tailwind.min.css`, …) resolves — correctly, because the document URL ends in `/index.html` rather than a bare directory — against the *proxy's* URL, so those sub-resource requests are proxied the same way, automatically; the route's path structure mirrors artifacts-server's own 1:1, just with the `/api/artifact-proxy` prefix in front.

The browser never learns artifacts-server's address at all — every artifact request, like every other backend call in this app, goes to `artifacts-viewer`'s own origin. That's what lets `artifacts-server` (and every other backend service) be private/internal-only in a real deployment; only `artifacts-viewer` needs to be publicly reachable.

**Rename/Delete from the sidebar** (`ArtifactSelector.tsx`, rendered by `ArtifactViewer.tsx` — the `/` page's "Pages" list): both are direct writes, not routed through opencode/chat at all — the one exception to "artifact content is only ever created/edited by `artifact-agent-service`", because neither touches content: Rename only rewrites `manifest.json`'s `title`, and Delete only removes the whole directory. Both go through the same path — `lib/api/catalog-client.ts` (`renameArtifactRequest`/`deleteArtifactRequest`) → `app/api/artifacts/[...slug]/route.ts` (`PATCH`/`DELETE`) → `lib/api/artifacts-catalog-client.ts` → `artifacts-server`'s `PATCH`/`DELETE /api/artifacts/*` (§2) — and the same gate: OWNER only. `ArtifactSelector` only renders both buttons when the caller's own resolved role is OWNER, and Rename/Delete prompt with a native `window.prompt()`/`confirm()` before calling through; both are UX conveniences, not the real gate, which is the server-side role check. Editing an artifact's actual content still only happens via `/chat` — reachable through `ExistingArtifactsPanel`'s own Edit button there, same as before this sidebar existed; the viewer sidebar itself has no content-editing entry point.

**Persisted-data flow (the `postMessage` bridge)** — now generic over the tool catalog instead of a fixed `table`/`method`/`id` CRUD shape:
1. The artifact's JS posts `{ source: 'artifact-data-bridge', type: 'request', requestId, tool, args, confirmed }` to `window.parent` — it holds no credentials and cannot reach any backend on its own (sandboxed, no `allow-same-origin`, and `connect-src 'none'` blocks any outbound call it might attempt anyway).
2. `useArtifactDataBridge.ts` validates the sender via `event.source === iframe.contentWindow` (**not** `event.origin`, since a sandboxed iframe's origin is the opaque string `"null"`), then — if the parent app itself has a session — makes the real request itself: `fetch('/api/tools/<tool>', { method: 'POST', headers: { Authorization: Bearer <session token> }, body: { args, confirmed } })`, using the logged-in user's own session. With no session, it short-circuits to a `401`/`UNAUTHENTICATED` response without ever calling the BFF.
3. `app/api/tools/[name]/route.ts` is a thin BFF proxy to `tool-service`'s `POST /tools/:name/execute` (`lib/api/tool-service-client.ts`'s `executeTool`) — no CORS — deliberately, as defense-in-depth against any artifact that somehow tried to call them directly. (`login`/`register` get their own dedicated routes, §above, since they're unauthenticated and conceptually distinct from an authenticated data-bridge call.)
4. The result — `{ ok: true, data }` or `{ ok: false, error, code }`, whatever `tool-service` returned, unmodified — is posted back to the iframe as `{ source: 'artifact-data-bridge', type: 'response', requestId, status, body }`.

**Modules:**
- `lib/config/env.ts` — `getArtifactsServerUrl()`, `getArtifactAgentServiceUrl()`, `getDbAgentServiceUrl()`, `getToolServiceUrl()` — all **server-only** now (none of them are `NEXT_PUBLIC_*`); the browser talks exclusively to this app's own `/api/*` routes, never directly to any backend service
- `lib/api/tool-service-client.ts`, `artifact-agent-service-client.ts`, `db-agent-service-client.ts`, `artifacts-catalog-client.ts` — server-only (`import 'server-only'`) clients for each backend; `lib/api/catalog-client.ts`, `artifact-chat-client.ts`, `db-chat-client.ts`, `skills-client.ts`, `session-client.ts` — matching browser-side clients that call this app's own BFF routes
- `app/api/tools/{login,register}/route.ts` + `app/api/tools/[name]/route.ts`, `app/api/artifacts/route.ts` (list) + `app/api/artifacts/[...slug]/route.ts` (rename/delete), `app/api/artifact-proxy/[...path]/route.ts`, `app/api/chat-artifact/{route.ts,providers/route.ts}`, `app/api/chat-db/route.ts`, `app/api/skills/{route.ts,[name]/route.ts}` — the BFF routes bridging browser ↔ each backend
- `lib/session/session-context.tsx` — React context holding the `tool-service` session, plus `login`/`register`/`logout`
- `hooks/useArtifactDataBridge.ts` — the postMessage mediator described above
- `hooks/useArtifactCatalog.ts`, `hooks/useArtifactSrc.ts` — fetches the role-scoped catalog and builds the iframe `src`, both keyed on the session's access token directly
- `components/ArtifactSelector.tsx` (a sidebar list of pages, not a dropdown), `ArtifactFrame.tsx` (accepts a `reloadNonce` prop to force a remount/reload independent of `src`), `ArtifactViewer.tsx` (its sidebar links to both `/chat` and `/db-chat`), `components/auth/AuthWidget.tsx` + `ProfileMenu.tsx` (email/role/logout, opens as a popup from a profile chip — no `RoleSwitcher`, roles are never user-selectable) — composed in `app/page.tsx`

**Iframe sandboxing** (`ArtifactFrame.tsx`) — artifacts are treated as untrusted, potentially AI-generated (and thus potentially adversarial) content:
- `sandbox="allow-scripts"` **only** — no `allow-same-origin` (the framed document gets a unique opaque origin, so it can't read this app's — or even its own origin's — cookies/storage), no forms, popups, top-navigation, downloads, or modals.
- No `allow` (Permissions Policy) features are delegated.
- `referrerPolicy="no-referrer"` — no page URL is ever sent as a `Referer` header for navigations or sub-resource loads originating from inside the iframe (now purely a same-origin concern, since the browser talks to `/api/artifact-proxy` on this app's own origin, not to `artifacts-server` directly).
- The iframe is keyed by `src` plus a `reloadNonce` counter, so switching artifact — or an explicit "⟳ Refresh" click, or a new chat response landing — fully remounts it rather than reusing stale state, even when the URL string itself hasn't changed.
- `artifacts-server` additionally sends `Content-Security-Policy: connect-src 'none'` on every artifact document — forwarded through `/api/artifact-proxy` unchanged (§6's artifact-proxy note) — so even outbound network calls the sandbox attribute itself doesn't restrict are blocked at the browser level.

### Artifact Chat page (`/chat`)

Lets a user create or update an artifact by chatting instead of hand-writing HTML, and manage opencode Skills without leaving the page.

- `app/chat/page.tsx` → `components/chat/ChatPage.tsx` — owns the conversation state (`messages`, the target `slug`, selected `provider`, selected skills, the live preview pane)
- `components/chat/ChatMessageList.tsx`, `ChatComposer.tsx`, `ProviderSelector.tsx`, `ExistingArtifactsPanel.tsx` — presentational pieces for the conversation and artifact-switching
- `components/chat/SkillSelector.tsx` — a row of toggleable chips, one per skill; selections persist across turns until toggled off
- `components/chat/SkillsPanel.tsx` — inline create/edit/delete UI for skills, calling `/api/skills`; toggled in place of `ExistingArtifactsPanel` by a header button
- `lib/chat/types.ts`, `lib/skills/types.ts` — the wire types shared between the proxies and the UI

**Flow:** composer submits → if any skills are selected, the message is rewritten to `Use these skills: "a", "b". <original text>` (visible in the transcript — no hidden text) → optimistic user message appended → `POST /api/chat-artifact` with the full message list, the current `slug` (`null` on the first turn), and the selected provider → `artifact-agent-service` returns the assistant's reply plus the artifact's `url_path` → the page adopts the returned `slug`/`url_path` so the *next* message updates the same artifact instead of creating a new one, and the preview pane's iframe reloads against it (both automatically, after every response, and on demand via the refresh button).

### Database Chat page (`/db-chat`)

Lets a user ask natural-language questions about the data instead of building or reading an artifact — no preview pane, no skills, no artifact `slug`, just a conversation.

- `app/db-chat/page.tsx` → `components/db-chat/DbChatPage.tsx` — owns the conversation state and renders its own message list/composer inline (simple enough not to warrant splitting into the same sub-components as `ChatPage.tsx`)
- `lib/db-chat/types.ts` — the wire types shared between the proxy and the UI, hand-mirroring `db-agent-service`'s `src/schemas.ts` the same way `DbChatMessage` already did — not shared through a package, matching this repo's existing per-side wire-type convention
- `lib/api/db-chat-client.ts` — browser-side client; `sendDbChatMessage` sends `POST /api/chat-db` with the message list, carrying the current session's access token as an `Authorization: Bearer` header (via `useSession()`, the same session object every other tool-service-aware part of this app reads from)
- `app/api/chat-db/route.ts` — BFF route, extracting that header with `lib/http/data-request-auth.ts` (the same helper `app/api/tools/[name]/route.ts` uses) — `401` if missing — then calling `lib/api/db-agent-service-client.ts`'s `chatWithDbAgent`, which forwards to `db-agent-service`'s `/agent/chat-db`

**Flow:** composer submits → optimistic user message appended → `POST /api/chat-db` with the full message list and the caller's `tool-service` JWT (never the message body — always the `Authorization` header) → `db-agent-service` runs its generic tool-catalog loop (§5) against `tool-service` under that same JWT, so every read or write it can perform is exactly what that user's role and the target tool's own logic allow. The response is appended to the transcript as a normal bubble; when the request implies a write, that text is a plain-language description of the intended change asking for confirmation — the same composer is how the user says "yes, go ahead" on the next turn, which is what lets the model set `confirmed: true` on its next matching tool call (§5). There's no artifact, no preview pane, and no cross-turn server-side session — each turn just resends the full message list.

---

## Security model summary

| Concern | Mechanism |
|---|---|
| Artifact can't read parent cookies/storage/DOM | `sandbox="allow-scripts"` with no `allow-same-origin` → opaque origin |
| Artifact can't submit forms / navigate top / open popups | No `allow-forms`/`allow-top-navigation`/`allow-popups` on the sandbox attribute |
| Artifact can't make its own network calls (external or internal) | `Content-Security-Policy: connect-src 'none'` on every artifact HTML response |
| Artifact can't hold or leak a real database credential | It never receives one — all data access goes through `postMessage` → `useArtifactDataBridge.ts`, which holds the session and makes the request itself |
| A forged/spoofed `postMessage` sender | Validated via `event.source === iframe.contentWindow`, not `event.origin` (which is `"null"` for a sandboxed frame either way) |
| Authorization on actual data | App-layer: each `tool-service` tool's own `requiredRoles` check (enforced centrally in `tools.router.ts` before a handler ever runs) plus whatever validation the handler itself performs — see §3 for why this replaced Postgres RLS, and where that coverage is still narrower than RLS's per-row guarantee (`list_rows`) |
| Runtime database access is over-privileged | `tool-service` holds exactly one Prisma credential for the whole system; every write of consequence goes through `withAuditedTransaction` so it's paired with an `AuditEvent` row in the same transaction |
| A caller's role can't be forged by decoding/trusting the token client-side | `artifacts-server` and `db-agent-service` never inspect the token itself — they always ask `tool-service`'s `/auth/verify` (or, for `db-agent-service`, `tool-service`'s own per-tool checks), the one place (holding `JWT_SECRET`) that can actually verify one |
| Tool catalog / argument shapes need to be known ahead of time by AI-generated code | opencode's `get_tools` tool and `db-agent-service`'s own catalog fetch both read `tool-service`'s live `GET /tools` — no hardcoded, driftable list on either side |
| AI-generated artifact code doesn't know what backend calls actually exist | `get_tools` fetches the real tool catalog (names, argument JSON Schema, mutate/destructive flags, required roles) before code is written |
| A Skill created through `/agent/skills` being genuinely discovered mid-generation | opencode's built-in Skill discovery reads `.opencode/skills/*/SKILL.md` from the artifacts directory this service writes to directly |
| The database chat agent could see or change more than the asking user is allowed to | `db-agent-service` holds no database credential and no tool-specific logic of its own — every read and write goes through a named `tool-service` tool under the caller's own JWT (§5), so that tool's own role check and handler logic decide what's allowed, not the agent |
| The database chat agent could leak that a restricted result exists | A tool-scoped-empty result and a genuinely-empty result are meant to be indistinguishable to the model by design; its system prompt explicitly forbids speculating about *why* a result was empty (§5) |
| The database chat agent could write data without the user realizing | A mutating tool's Anthropic-facing schema requires `confirmed: true`, its description instructs "explain first, wait, then confirm," and `runTool` refuses to forward an unconfirmed call to `tool-service` at all — `tool-service`'s own `409` (§3) is an independent second gate below that |
| The two chat agents could leak a JWT or bypass each other's boundaries | No shared state between them — `artifact-agent-service` never receives a `tool-service` JWT at all, and `db-agent-service` never touches the artifacts filesystem, opencode, or any database credential |
| Backend services (`artifacts-server`, both agents, `tool-service`) shouldn't need public exposure | The browser only ever calls `artifacts-viewer`'s own `/api/*` routes (§6) — including artifact content itself, via `/api/artifact-proxy` — which reach every backend service server-side; none of `getArtifactsServerUrl()`/`getArtifactAgentServiceUrl()`/`getDbAgentServiceUrl()`/`getToolServiceUrl()` are `NEXT_PUBLIC_*`, so none of those addresses ever reach client code |

`services/artifacts-server/artifacts/sandbox-security-test/` is a live artifact that exercises every row in this table it's positioned to reach from inside a sandboxed iframe and reports pass/fail for each — open it any time to re-verify the sandbox after changing anything here.

---

## Running everything locally

See the top-level [README.md](./README.md) for step-by-step setup and run instructions, including which `.env` files need which keys.

## Status

The full `supabase-service` → `tool-service` migration (Phases 1–7) is complete: `tool-service` is the only service holding a database credential, every other service (`artifacts-server`, `artifact-agent-service`/opencode, `db-agent-service`, `artifacts-viewer`) has been repointed to it, and `services/supabase-service/` no longer exists in the repo.

This phase (7) specifically deleted `supabase-service` and its now-unused schema-introspection RPC migrations, removed it from the workspace's `nx`/`tsconfig`/`package.json`/editor-debug config, and verified live: a `grep` across every other service and app for any Supabase-specific env var, port literal, or import path came back clean (one intentional artifact — `sandbox-security-test`'s own attempted-bypass fetch — was repointed from the old `:3335` to `tool-service`'s `:5104` rather than left calling a port nothing listens on anymore); `npm run dev` starts exactly `artifacts-server`, `tool-service`, `artifact-agent-service`, `db-agent-service`, and `artifacts-viewer` with no unreachable-service warnings from any of them; and a full register → login → view catalog → open an artifact → data-bridge read → data-bridge confirmed-write pass was run end-to-end against the real Prisma-backed database, live (register and login against `tool-service`'s own tools, an artifact fetched successfully through `artifacts-server`'s role check, a `list_rows` read and a confirmed `create_material` write both round-tripping correctly through `artifacts-viewer`'s `/api/tools/:name` BFF).

Everything through §4/§6's Artifact Chat flow, the `db-agent-service`/Database Chat flow, and the sandboxed rendering/CSP/postMessage-bridge security model has been verified live against this same tool-service-backed stack. Not yet built: an artifact publishing/upload flow beyond the agent, and e2e test suites (removed from this workspace for now). Known, pre-existing drift unrelated to this phase: `apps/artifacts-viewer`'s Database Chat UI (`DbChatPage.tsx`, `FormRequestCard.tsx`) and its `/api/submit-form` route still reference a `form_request` response variant and a `submitFormWithDbAgent` call against `db-agent-service`'s `/agent/submit-form` — but `db-agent-service`'s `ChatDbResponse` (§5) has been simplified to a single `text` variant and no longer registers a `/agent/submit-form` route at all, so that code path is unreachable today. It doesn't touch `tool-service`/`supabase-service` and wasn't introduced or masked by this phase, but is worth a follow-up cleanup pass.
