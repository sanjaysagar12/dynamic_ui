# Dynamic UI — Architecture Overview

This Nx workspace implements an **Artifacts platform**: a static-file server that serves role-gated "artifacts" (self-contained HTML/CSS/JS bundles) similarly to Apache, a Supabase middle layer that holds the only database credentials in the system and is also the sole authority on "who is this caller and what role do they have", an artifact agent that drives [opencode](https://opencode.ai) to generate and update artifacts (and their reusable Skills) from a chat prompt, a database agent that answers natural-language questions about the data itself — strictly scoped to the caller's own Supabase permissions via Row-Level Security — and a Next.js viewer that renders artifacts in a sandboxed iframe, mediates their data access over `postMessage`, and hosts both chat experiences.

Identity is real Supabase Auth throughout — there is no dev-JWT stand-in service anymore. A user logs in once with Supabase; every other service that needs to know who they are (and what role they have) asks `supabase-service`, never decodes anything itself.

```
apps/
  artifacts-viewer/     Next.js app — Artifact Chat + Database Chat pages, sandboxed iframe viewer + postMessage
                          data bridge (port 4200)
services/
  artifacts-server/     Fastify app — serves artifacts, verifies the caller via supabase-service + a locked-down CSP (port 3400)
                          artifacts/.opencode/tool/get_schema.ts, artifacts/.opencode/skills/*/SKILL.md, and
                          artifacts/AGENTS.md — opencode's project-local schema tool, reusable Skills, and
                          artifact-authoring instructions, shared by every artifact directory underneath
  supabase-service/      Fastify app — anon-key-only middle layer between the parent app and Supabase; also the
                          only place that turns a Supabase access token into a verified identity + role (port 3335).
                          Every other service that needs to read Supabase data on a user's behalf — including
                          db-agent-service below — goes through this one, never a Supabase client of its own.
  artifact-agent-service/ TypeScript/Fastify app — turns a chat prompt into an artifact by shelling out to opencode,
                          and owns CRUD for opencode Skills (port 5102); endpoint: POST /agent/chat-artifact
  db-agent-service/      TypeScript/Fastify app — answers natural-language questions about the data, asks for
                          insert/update fields through a schema-driven form instead of guessing or asking in
                          prose, and deletes rows (only after explaining the change and getting the user's
                          go-ahead), all through supabase-service under the caller's own Supabase JWT, so RLS —
                          not this service — decides what's actually allowed (port 5103); endpoints:
                          POST /agent/chat-db, POST /agent/submit-form
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

## 2. `services/artifacts-server` (port 3400)

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

**Config** (`config.ts`): `PORT` (default `3400` — chosen to avoid the common `3000` collision with other services on a shared host), `ARTIFACTS_ROOT` (default `<project>/artifacts`), `SUPABASE_SERVICE_URL` (default `http://localhost:3335`) — where `supabase-service` lives, since every request now needs a real network round-trip to verify.

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
POST /rpc/:function  { ...args }                                          → { data: <whatever the function returns> }
GET  /health
```
`:table` is schema-agnostic (validated against a plain identifier regex) — this works against any table, not a hardcoded one. In `/data/:table` list requests, every query-string key is treated as an exact-match column filter **except** two reserved keys: `order` (`column.asc` / `column.desc`) and `limit` (row count) — see `data/records.service.ts`.

`/rpc/:function` is `/data/:table`'s counterpart for things that aren't expressible as a table read/write — currently used only for schema-introspection RPCs (below), but generic: it forwards to `client.rpc(fn, args)` under the caller's own token, same as `/data`, and doesn't itself decide what's callable — Postgres GRANTs (and, for `SECURITY DEFINER` functions, the function's own internal logic) are the actual authorization boundary, exactly like RLS is for `/data`.

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
- `data/rpc.service.ts` / `rpc.controller.ts` — `RpcService`: the generic `/rpc/:function` proxy described above
- `middleware/error-handler.ts` — catch-all error handler registered via `fastify.setErrorHandler`; anything that reaches it gets logged server-side and returned as `{ error: message }` with a real status code, instead of Fastify's default error handler
- `config.ts` — `PORT` (default `3335`), `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- `sql/003_create_table_constraints_rpc.sql`, `004_create_enum_values_rpc.sql`, `005_create_schema_columns_rpc.sql` — one-time migrations (run by hand in the Supabase SQL Editor, not by any app code) defining three `SECURITY DEFINER` Postgres functions, each `GRANT EXECUTE`d to `anon`/`authenticated`. They read Postgres's own catalogs (`pg_constraint`, `pg_enum`, `information_schema.columns`) for the `public` schema — real constraints, real enum values, real column types — callable via this service's `/rpc/*` proxy with **no secret key**, unlike PostgREST's OpenAPI/schema endpoint (below). `db-agent-service`'s `SchemaService` (§5) is what actually calls all three.

**Why no `/schema` endpoint here:** Supabase's own schema/OpenAPI introspection endpoint (`GET /rest/v1/` with `Accept: application/openapi+json`) rejects anon keys outright ("Secret API key required"), which conflicts with this service's anon-key-only design — that specific endpoint is only ever called by opencode's `get_schema` tool (§4), which is allowed to hold a secret key because it's never in the runtime request path for artifact data. The three RPCs above exist precisely to get most of the same information (columns, constraints, enum values — everything except PostgREST's own OpenAPI-format column typing) through a path that doesn't need one.

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
- **`.opencode/tool/get_schema.ts`** — a custom opencode tool that calls Supabase's `GET /rest/v1/` with `Accept: application/openapi+json` **using the secret key**, reporting real table/column names, nullability, enum-typed columns' exact allowed values (PostgREST includes these inline in the OpenAPI document — no extra RPC needed), and — via a `get_table_constraints` SECURITY DEFINER RPC (`services/supabase-service/sql/003_create_table_constraints_rpc.sql`) — primary/foreign/unique/CHECK constraints. Invoked as a tool call, on demand, not always in context.
- **`.opencode/skills/*/SKILL.md`** — reusable, named procedures (e.g. "our house style for a CRUD form", "how to detect the current user's role correctly"), each with a `name` + `description` frontmatter and a markdown body. Every skill's `name`+`description` is always in context (cheap — just a menu of what's available); a skill's full body is only loaded when opencode actually decides to use it, via its built-in `skill` tool call. The chat UI can name a skill explicitly in the message text to make that decision reliable rather than left to the model's own judgment (see `ChatPage.tsx`, §6) — but opencode can and does pick a relevant skill up from wording alone too. Managed via the `/agent/skills` endpoints above, which write/read/delete `SKILL.md` files directly (`src/services/skill-service.ts`) — no YAML dependency, since the format is just two string fields in a small hand-rolled frontmatter parser.

**Config** (`src/config.ts`): `PORT` (default `5102` — chosen to avoid a `5002` collision with another service on a shared host), `ARTIFACTS_SERVER_URL`, `ARTIFACTS_ROOT` (default `../artifacts-server/artifacts`), `OPENCODE_BIN` (default `opencode`, resolved via `PATH`), `OPENCODE_TIMEOUT_SECONDS` (default `900`), `LLM_PROVIDER`/`ANTHROPIC_MODEL`/`GEMINI_MODEL` (default model choices), plus `SUPABASE_URL`/`SUPABASE_SECRET_KEY` — needed here (not in a separate service) because the opencode subprocess inherits this process's environment, and that's what its `get_schema` tool reads.

**Why the secret key is safe here:** `get_schema` is only ever invoked by opencode at artifact-*generation* time, server-side, to look up real table/column names before writing code — it is never in the path of a running artifact's data requests (those go through `supabase-service`, anon-key-only, RLS-scoped). No artifact, and no browser code, ever sees this key or this endpoint.

---

## 5. `services/db-agent-service` (port 5103, TypeScript/Fastify)

Answers natural-language questions about the data itself — "how many open jobs are due this week?", "what's the stock balance on material X?" — instead of generating UI. Deliberately kept separate from `artifact-agent-service`: it holds no opencode subprocess, no artifacts-root filesystem access, and no Supabase key of any kind, so there's no shared state between the two agents that could leak a JWT or let one bypass the other's boundaries.

**Endpoints:**
```
POST /agent/chat-db     { messages, jwt, model? }  → ChatDbResponse — jwt is the caller's own Supabase access token
POST /agent/submit-form { table, operation, match?, values, messages, jwt }  → ChatDbResponse (always the 'text' variant)
GET  /health
```
`ChatDbResponse` (`src/schemas.ts`) is a discriminated union — `{ type: 'text', content, messages }` or
`{ type: 'form_request', content, form, messages }` — instead of the plain `{ reply, messages }` shape this
endpoint used to return; `content` replaces the old `reply` field.

**How a chat turn works** (`src/services/db-chat-service.ts`):
1. `SchemaService.describe(jwt)` (`src/services/schema-service.ts`) resolves the "known tables and columns" section of the system prompt — see below. This runs before the Anthropic call, every turn (served from cache after the first).
2. The full message history is sent to Claude (`@anthropic-ai/sdk`, called directly — no opencode involved) along with that schema description, the static `RLS_BEHAVIOR_GUIDANCE` text (`src/services/schema-context.ts`), and three tools: `query_table` (read: table name + optional column filters/order/limit), `request_form` (ask the user to fill/confirm the fields for an insert or update through a form — see below), and `write_table` (delete a single row only — create/update go through `request_form` instead, so a written value always came from a form the user actually saw).
3. Every tool call is forwarded to `services/supabase-service`'s `/data/:table` endpoints (`src/services/supabase-query-client.ts`, `GET`/`POST`/`PATCH`/`DELETE`) with the caller's own JWT as the `Authorization` header — **not** a service-role key. This is the same "dedicated Supabase service" every other part of the system already uses for user-scoped data access (§3); `db-agent-service` doesn't roll its own Supabase client, it's just another caller of `supabase-service`. Row-Level Security on the Postgres side, not this agent's own judgment, decides what's actually allowed to come back or be written.
4. The loop runs for up to `DB_AGENT_MAX_TOOL_ITERATIONS` (default 6) rounds of tool calls; the final round is made with no tool offered at all, forcing a plain-text answer instead of another query. A successful `request_form` call ends the turn immediately instead — the conversation must pause for the user to actually fill and submit the form, so there's no tool-result round-trip to continue.
5. The assistant's final text becomes the `text`-variant response's `content`, appended to the outward message history and returned — no server-side session state is kept between turns (unlike `artifact-agent-service`'s opencode sessions), since each turn just resends the full transcript. A `form_request` response flattens the model's own `intro` text into that same history in place of a full reply, so a later turn's resent transcript stays coherent plain text.

**Schema-driven write forms** (`request_form` tool, `src/services/form-spec-builder.ts`, `src/services/form-commit-service.ts`): instead of guessing a value or parsing one out of prose, the model calls `request_form` with a table, `insert`/`update`, an `intro` sentence, the column names it judges relevant (`fields`), and any values it's already confident about (`known_values`). `buildFormSpec` cross-references `SchemaService.getTableInfo` (the same live columns/constraints/enums `describe()` fetches, exposed structurally instead of only as the formatted prompt string) to build a `FormFieldSpec[]`: real column types (`text`/`number`/`boolean`/`date`), enum columns become `select` with their real allowed values, single-column foreign keys (parsed from `pg_get_constraintdef`'s `FOREIGN KEY (...) REFERENCES table(col)` text) become `foreign_key` with a `referenceTable`/`referenceLabelColumn` guess, and `required` always comes from the live `NOT NULL`/no-default constraint — never from the model. A field only ever gets a `default` from the model's own `known_values`, never from a DB-side column default (e.g. `now()`) and never fabricated. On `insert`, any `NOT NULL`/no-default column the model didn't ask for is force-included anyway, so a model that forgets a required column still can't produce a form missing it. The frontend renders this form, the user fills and confirms it, and only then does `POST /agent/submit-form` (`FormCommitService`) actually write — re-deriving the same live schema to recompute `required`-ness and reject any field name that isn't a real column, rather than trusting anything the client sent, then calling the same `createRow`/`updateRow` on `SupabaseQueryClient` every other write already uses.

**Schema knowledge is live, not hand-maintained** (`src/services/schema-service.ts`): `SchemaService` calls three read-only Postgres RPCs through `supabase-service`'s `/rpc/:function` proxy (§3) — `get_schema_columns`, `get_table_constraints`, `get_enum_values` — under the caller's own JWT, and formats the result the same way opencode's `get_schema` tool formats its own findings (table: columns, with `CONSTRAINT —` lines for PK/FK/UNIQUE/CHECK and enum-typed columns' allowed values inline). All three RPCs are `SECURITY DEFINER` and granted to `anon`/`authenticated` (`services/supabase-service/sql/003_create_table_constraints_rpc.sql`, `004_create_enum_values_rpc.sql`, `005_create_schema_columns_rpc.sql`) — deliberately callable with **no secret key**, matching this service's "holds no Supabase key at all" design, unlike `get_schema`'s use of PostgREST's OpenAPI endpoint (§4), which Supabase rejects for anon keys outright. Since these RPCs read Postgres's own catalogs rather than any RLS-governed application table, the result is identical for every caller — it's cached process-wide for `DB_AGENT_SCHEMA_CACHE_TTL_SECONDS` (default 300s) rather than per-user, so an ordinary multi-turn conversation doesn't re-fetch it every turn, but a real schema change still surfaces within a few minutes with no code change or redeploy. If the base `get_schema_columns` call fails (network error, or the migrations above were never run against this project), `describe()` serves a stale cache if one exists, or otherwise a plain fallback string telling the model to ask the user for table/column names rather than guess — confirmed live: with the migrations not yet applied, a question like "how many products do we have?" gets a reply asking "Is the product data stored in a table called `products`?" instead of a wrong guess or a crash. If just the constraints/enum-values RPCs are unavailable, only that enrichment is dropped (empty `CONSTRAINT`/`allowed:` info), not the whole lookup.

This directly replaces an earlier hand-maintained version of this same file: it was originally written from `packages/sql/01_create_tables.sql`, a much larger aspirational ERP schema that turned out not to be what's actually deployed on this project's live Supabase instance (the real schema is `users`, `categories`, `products`, `stock_transactions`) — every query the agent tried against the aspirational table names failed with "table not found in the schema cache," surfacing to users as a generic "I ran into a problem" reply. That was hand-corrected once as a stopgap; `SchemaService` is the actual fix, since a hand-maintained copy can drift again the next time the schema changes.

**Every write requires the user's explicit confirmation before it happens — the shape of that confirmation depends on the write.** A delete still goes through `write_table`: the system prompt instructs the model to reply in plain text first, describing exactly what it's about to do (table, which row) and wait — it must not call `write_table` in that same turn — and only call it again, with `confirmed: true`, after the user's own later message clearly agrees; the tool itself refuses the call otherwise (`runWriteTable` in `db-chat-service.ts` checks `confirmed === true` before touching `supabase-service` at all), so a model that "forgets" to ask is blocked at the tool boundary, not just by prompt discipline. An insert/update instead goes through the `request_form` → form → `POST /agent/submit-form` flow above — the user's confirmation is filling in and confirming the rendered form itself, which doubles as the missing-field problem `write_table`'s old create/update path never solved. Either way this is a workflow/UX gate, not a security boundary — RLS is still what actually decides whether a write is allowed; a confirmed write a caller isn't permitted to make is still rejected by Postgres.

**RLS-empty vs. real errors** (`src/core/errors.ts`, `src/services/supabase-query-client.ts`): a `200` with an empty array from `supabase-service` — whether because no rows exist or because RLS filtered every row out for this caller — is treated as an ordinary, successful "no data" result and fed back to the model as such; the system prompt explicitly forbids the model from speculating about *why* a result was empty, so it can't leak that restricted rows exist. A non-2xx response from `supabase-service` (bad table name, upstream failure, a write RLS rejects) is a distinct `SupabaseQueryError`, surfaced to the model as a tool error so it reports a problem instead of silently claiming success or "no data". A `401` is treated differently again — `SupabaseAuthError` aborts the whole turn and the route returns `401`, since an invalid/expired session is a caller-facing auth failure, not something the conversation should try to route around.

**Config** (`src/config.ts`): `PORT` (default `5103` — chosen to avoid a `5003` collision with another service on a shared host), `SUPABASE_SERVICE_URL` (default `http://localhost:3335`), `ANTHROPIC_API_KEY` (the only credential this service holds — authenticates it to Anthropic, never to Supabase), `DB_AGENT_MODEL` (default `claude-sonnet-5`), `DB_AGENT_MAX_TOOL_ITERATIONS` (default `6`), `DB_AGENT_SCHEMA_CACHE_TTL_SECONDS` (default `300`).

---

## 6. `apps/artifacts-viewer` (port 4200)

A Next.js (App Router) app. There's no role picker anywhere — a user logs in with real Supabase credentials, and their role is whatever `supabase-service` reports for their account. The artifact list, the sidebar, and both chat pages all just reflect that.

**Artifact rendering flow:**
1. The user logs in via `SupabaseSessionWidget.tsx` (`POST /api/supabase/login`, a BFF route to `supabase-service`'s `/auth/login`). The resulting `{ accessToken, userId, email }` is held in React state (`supabase-session-context.tsx`), never in `localStorage`/cookies.
2. That same Supabase access token is what's used everywhere a token is needed — there is no separate token-minting step. `useArtifactCatalog.ts` calls this app's own `GET /api/artifacts` with `Authorization: Bearer <token>`, which forwards to `artifacts-server`'s `GET /api/artifacts` (`lib/api/artifacts-catalog-client.ts`); the response includes both the visible artifacts **and** the caller's resolved `role`, straight from `artifacts-server`'s own verification — the frontend never computes or stores a role independently.
3. `useArtifactSrc.ts` → `buildArtifactUrl()` builds `/api/artifact-proxy/<artifact-path>/index.html?token=<the same Supabase access token>` — a same-origin, relative URL, **not** a direct link to `artifacts-server` — and sets it as the iframe `src` (a query param, not a header, because a plain iframe navigation can't attach `Authorization`). Explicitly naming `index.html` (rather than a bare directory path ending in `/`) is deliberate: Next.js's own routing strips a trailing slash via redirect before this route ever runs (`trailingSlash: false`, the default), which would otherwise land the iframe's committed document URL one path segment short of where the artifact's relative asset hrefs expect it to be. Naming the file explicitly sidesteps that — no trailing slash for Next to strip, and artifacts-server serves it directly with no redirect of its own either (`artifact-path-resolver.ts` only redirects when a *directory* is requested without a slash).
4. `app/api/artifact-proxy/[...path]/route.ts` forwards that request server-side to `artifacts-server` (`getArtifactsServerUrl()`), streaming the response straight back — status, body, and specifically the `Content-Security-Policy` header artifacts-server sets on HTML responses (§2), since that header is a real security control the browser must actually receive, not just an implementation detail safe to drop. `artifacts-server` verifies the token via `supabase-service` and checks the resolved role against the manifest exactly as described in §2, and returns the artifact — or a JSON error, which just renders as text inside the frame.
5. Every relative `href`/`src` artifacts-server's own `html-token-rewriter.ts` rewrites into the artifact's HTML (`assets/app.js`, `../_shared/tailwind.min.css`, …) resolves — correctly, because the document URL ends in `/index.html` rather than a bare directory — against the *proxy's* URL, so those sub-resource requests are proxied the same way, automatically; the route's path structure mirrors artifacts-server's own 1:1, just with the `/api/artifact-proxy` prefix in front.

The browser never learns artifacts-server's address at all — every artifact request, like every other backend call in this app, goes to `artifacts-viewer`'s own origin. That's what lets `artifacts-server` (and every other backend service) be private/internal-only in a real deployment; only `artifacts-viewer` needs to be publicly reachable.

**Persisted-data flow (the `postMessage` bridge)** — unchanged in shape from the token flow above, just now built entirely on the one real Supabase session:
1. The artifact's JS posts `{ source: 'artifact-data-bridge', type: 'request', requestId, table, method, id, body, search }` to `window.parent` — it holds no credentials and cannot reach any backend on its own (sandboxed, no `allow-same-origin`, and `connect-src 'none'` blocks any outbound call it might attempt anyway).
2. `useArtifactDataBridge.ts` validates the sender via `event.source === iframe.contentWindow` (**not** `event.origin`, since a sandboxed iframe's origin is the opaque string `"null"`), then makes the real request itself — `fetch('/api/data/<table>[/<id>][?search]', { headers: { Authorization: Bearer <supabase token>, X-User-Id } })` — using the logged-in user's own session.
3. `app/api/data/[table]/route.ts` and `[id]/route.ts` are a thin BFF proxy to `supabase-service`'s `/data/:table` endpoints (no CORS — deliberately, as defense-in-depth against any artifact that somehow tried to call them directly).
4. The result is posted back to the iframe as `{ source: 'artifact-data-bridge', type: 'response', requestId, status, body }`.

**Modules:**
- `lib/config/env.ts` — `getArtifactsServerUrl()`, `getArtifactAgentServiceUrl()`, `getDbAgentServiceUrl()`, `getSupabaseServiceUrl()` — all **server-only** now (none of them are `NEXT_PUBLIC_*`); the browser talks exclusively to this app's own `/api/*` routes, never directly to any backend service
- `lib/api/supabase-service-client.ts`, `lib/api/artifact-agent-service-client.ts`, `lib/api/db-agent-service-client.ts`, `lib/api/artifacts-catalog-client.ts` — server-only (`import 'server-only'`) clients for each backend; `lib/api/catalog-client.ts`, `artifact-chat-client.ts`, `db-chat-client.ts`, `skills-client.ts` — matching browser-side clients that call this app's own BFF routes
- `app/api/supabase/{login,signup}/route.ts`, `app/api/data/[table]/{route.ts,[id]/route.ts}`, `app/api/artifacts/route.ts`, `app/api/artifact-proxy/[...path]/route.ts`, `app/api/chat-artifact/{route.ts,providers/route.ts}`, `app/api/chat-db/route.ts`, `app/api/skills/{route.ts,[name]/route.ts}` — the BFF routes bridging browser ↔ each backend (there is no `/api/token` route anymore)
- `lib/supabase/supabase-session-context.tsx` — React context holding the Supabase session, plus `login`/`signUp`/`logout`
- `hooks/useArtifactDataBridge.ts` — the postMessage mediator described above
- `hooks/useArtifactCatalog.ts`, `hooks/useArtifactSrc.ts` — fetches the role-scoped catalog and builds the iframe `src`, both keyed on the Supabase access token directly
- `components/ArtifactSelector.tsx` (a sidebar list of pages, not a dropdown), `ArtifactFrame.tsx` (accepts a `reloadNonce` prop to force a remount/reload independent of `src`), `ArtifactViewer.tsx` (its sidebar links to both `/chat` and `/db-chat`), `components/supabase/ProfileMenu.tsx` + `SupabaseSessionWidget.tsx` (email/role/logout, opens as a popup from a profile chip — no `RoleSwitcher`, roles are never user-selectable) — composed in `app/page.tsx`

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

- `app/db-chat/page.tsx` → `components/db-chat/DbChatPage.tsx` — owns the conversation state and renders its own message list/composer inline (simple enough not to warrant splitting into the same sub-components as `ChatPage.tsx`); also holds `pendingForm`, the `FormSpec` from the most recent `form_request` response, if any
- `lib/db-chat/types.ts` — the wire types shared between the proxies and the UI, hand-mirroring `db-agent-service`'s `src/schemas.ts` (`ChatDbResponse`'s `text`/`form_request` union, `FormSpec`/`FormFieldSpec`) the same way `DbChatMessage` already did — not shared through a package, matching this repo's existing per-side wire-type convention
- `lib/api/db-chat-client.ts` — browser-side client; `sendDbChatMessage` sends `POST /api/chat-db` with the message list, carrying the current Supabase session's access token as an `Authorization: Bearer` header (via `useSupabaseSession()`, the same session object every other Supabase-aware part of this app reads from); `submitDbChatForm` sends `POST /api/submit-form` the same way
- `app/api/chat-db/route.ts` / `app/api/submit-form/route.ts` — BFF routes, both extracting that header with `lib/http/data-request-auth.ts` (the same helper `app/api/data/[table]/route.ts` uses) — `401` if missing — then calling `lib/api/db-agent-service-client.ts`'s `chatWithDbAgent`/`submitFormWithDbAgent`, which forward to `db-agent-service`'s `/agent/chat-db`/`/agent/submit-form`
- `components/db-chat/FormRequestCard.tsx` — the generated write form, rendered inline in the thread (never a modal): one input per `FormFieldSpec` built from its `type` (`foreign_key` fetches its options from `GET /api/data/<referenceTable>`, the same RLS-scoped route the artifact data bridge uses), required fields blocked client-side until filled, then a read-only review step echoing back exactly what will be written before an explicit **Confirm** actually calls `submitDbChatForm`

**Flow:** composer submits → optimistic user message appended → `POST /api/chat-db` with the full message list and the caller's Supabase JWT (never the message body — always the `Authorization` header) → `db-agent-service` runs its `query_table`/`request_form`/`write_table` tool loop against `supabase-service` under that same JWT, so every row it can read or change is exactly what RLS allows this caller to. A `type: 'text'` response is appended to the transcript as a normal bubble; when the request implies a delete, that text is a plain-language description of the intended change asking for confirmation — the same composer is how the user says "yes, go ahead" on the next turn. A `type: 'form_request'` response instead sets `pendingForm`, rendering `FormRequestCard` right after the intro bubble — submitting it calls `/api/submit-form`, and the returned confirmation (always `type: 'text'`) replaces `pendingForm` with a normal bubble the same way. There's no artifact, no preview pane, and no cross-turn server-side session — each turn just resends the full message list.

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
| The database chat agent could see or change more than the asking user is allowed to | `db-agent-service` holds no Supabase key at all — every read and write goes through `supabase-service`'s `/data/:table` under the caller's own JWT (§5), so RLS decides what's actually allowed, not the agent |
| The database chat agent could leak that RLS-restricted data exists | An RLS-empty result and a genuinely-empty result are indistinguishable at the SQL level by design; `db-agent-service` treats both identically (`SupabaseQueryClient`, §5) and its system prompt explicitly forbids speculating about *why* a result was empty |
| The database chat agent could delete data without the user realizing | `write_table` (delete only) refuses to run unless called with `confirmed: true`, and the system prompt requires the model to have already explained the exact change and gotten an explicit go-ahead in a prior turn before setting that flag (§5) — this is a workflow gate, not a security one; RLS is still the actual authority on whether the write is allowed |
| The database chat agent could invent a value for an insert/update field the user never gave it | Create/update go through `request_form` instead of `write_table` — the model can only offer real columns from the live schema, `required` is computed from the live `NOT NULL`/no-default constraint (never the model), and a field only gets a `default` from the model's own `known_values`, never a guess (§5) |
| A form's client-side required-field check could be bypassed to write incomplete/invalid data | `POST /agent/submit-form` (`FormCommitService`) re-derives the same live schema server-side and rejects the request if a required field is missing or a field name isn't a real column, rather than trusting the client's `FormSpec` or values (§5) |
| The two chat agents could leak a JWT or bypass each other's boundaries | No shared state between them — `artifact-agent-service` never receives a Supabase JWT at all, and `db-agent-service` never touches the artifacts filesystem, opencode, or any Supabase key |
| Backend services (`artifacts-server`, both agents, `supabase-service`) shouldn't need public exposure | The browser only ever calls `artifacts-viewer`'s own `/api/*` routes (§6) — including artifact content itself, via `/api/artifact-proxy` — which reach every backend service server-side; none of `getArtifactsServerUrl()`/`getArtifactAgentServiceUrl()`/`getDbAgentServiceUrl()`/`getSupabaseServiceUrl()` are `NEXT_PUBLIC_*`, so none of those addresses ever reach client code |

`services/artifacts-server/artifacts/sandbox-security-test/` is a live artifact that exercises every row in this table (except the RLS/schema ones, which aren't reachable from an artifact by design) and reports pass/fail for each — open it any time to re-verify the sandbox after changing anything here.

---

## Running everything locally

See the top-level [README.md](./README.md) for step-by-step setup and run instructions, including which `.env` files need which keys.

## Status

Everything through §4/§6's Artifact Chat flow is implemented, builds, typechecks, and lints, and was verified end-to-end live against a real Supabase project: signup/login → `/auth/verify` resolving the real role from the `users` table → role-based 200/403/404 responses from `artifacts-server` → sandboxed rendering; the full `artifact-agent-service` (then `agent-service`) → opencode → artifacts-server chain (both creating a new artifact and editing an existing one across turns, including a confirmed session-continuity bug fix — resending full history on top of a live opencode session confused the model into re-validating the original request instead of applying the newest one); the postMessage data bridge performing real CRUD against Supabase through RLS; `get_schema` returning the real database schema, including enum-typed columns' exact allowed values, via the secret key held only by opencode's tool; a Skill created through `/agent/skills` being genuinely discovered and invoked by opencode mid-generation (confirmed via its tool-call event stream, not just that the file was theoretically visible); the CSP blocking external/internal fetches from inside the sandboxed iframe.

`db-agent-service` (§5) and the Database Chat page (§6) are newer, and have now been verified live against the real Supabase project directly through `/agent/chat-db` (not yet through the Next.js UI itself): a read question resolving real `products` rows through RLS; a create request correctly stopping to explain the exact row it intended to insert and ask for confirmation *before* touching the database; the same create actually executing, and the row appearing in Supabase, only after a follow-up message confirmed it. That first live test also caught a real bug worth recording — `packages/sql/01_create_tables.sql`'s schema didn't match what was actually deployed, so the schema description the agent relied on was wrong and every query failed with a generic "I ran into a problem" reply. `SchemaService` (§5) is the fix — live schema lookup instead of a hand-maintained copy — and was itself verified two ways: with `003`–`005`'s RPC migrations not yet applied to the live project, a question correctly produced "Is the product data stored in a table called `products`?" instead of a wrong guess or a crash (the intended fallback behavior, confirmed live); once those migrations are run, the same question should resolve real column/constraint/enum info instead of asking. Not yet built: an artifact publishing/upload flow beyond the agent, and e2e test suites (removed from this workspace for now).
