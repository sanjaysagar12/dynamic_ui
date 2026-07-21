# Dynamic UI — Architecture Overview

This Nx workspace implements an **Artifacts platform**: a static-file server that serves role-gated "artifacts" (self-contained HTML/CSS/JS bundles) similarly to Apache, a backend that issues development JWTs, an AI agent that generates and updates those artifacts from a chat prompt (Claude or Gemini), and a Next.js viewer with both a manual role-switching viewer and an AI chat page.

```
apps/
  artifacts-viewer/     Next.js app — role switcher + sandboxed iframe viewer, plus an AI chat page (port 4200)
services/
  artifacts-server/     Express app — serves artifacts, enforces JWT auth + role authorization (port 3000)
  backend-server/        Express app — issues development JWTs (port 3334)
  tool-service/          Python/FastAPI app — writes/reads artifact files on disk (port 5001)
  agent-service/         Python/FastAPI app — turns a chat prompt into an artifact via Claude or Gemini (port 5002)
packages/
  shared-auth/           Shared TypeScript library — Role types + JWT signing/verification
```

All five run independently and talk to each other only over HTTP; there is no shared runtime state.

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
```
`/dashboard/` and `/admin/users/` map 1:1 to `GET /dashboard/` and `GET /admin/users/` on the server. Nested asset requests (e.g. `/admin/users/assets/app.js`) resolve against the nearest ancestor directory that has a `manifest.json`, so an artifact's whole subtree shares one manifest.

**Request pipeline**, each concern in its own class:

| Module | Responsibility |
|---|---|
| `resolution/artifact-path-resolver.ts` | Maps a URL path → filesystem file, walking up to find the owning artifact directory (the nearest ancestor with `manifest.json`). Blocks path traversal and direct `manifest.json` access. Emits a trailing-slash redirect when a directory is requested without `/`. |
| `manifest/manifest-repository.ts` | Loads + caches `manifest.json` for an artifact directory. |
| `auth/authentication-provider.ts` + `jwt-authentication-provider.ts` | `AuthenticationProvider` interface with a JWT implementation — reads a Bearer header **or** a `?token=` query param (iframe `src` navigations can't set headers). |
| `authorization/authorization-strategy.ts` + `role-authorization-strategy.ts` | `AuthorizationStrategy` interface; the current implementation checks the authenticated role against `manifest.roles`. |
| `service/artifact-service.ts` | Orchestrates resolve → load manifest → authenticate → authorize. |
| `http/artifacts.router.ts` | Express router; maps errors to `401` (no/invalid token), `403` (role not permitted), `404` (artifact not found). |

Both `AuthenticationProvider` and `AuthorizationStrategy` are interfaces specifically so new auth methods (API keys, sessions) or authorization rules (ABAC, per-user overrides) can be added without touching the rest of the pipeline.

**Config** (`config.ts`): `PORT` (default `3000`), `ARTIFACTS_ROOT` (default `<project>/artifacts`), `JWT_SECRET`, `JWT_ISSUER` (default `backend-server` — **must match** `backend-server`'s issuer for token verification to succeed).

---

## 4. `services/tool-service` (port 5001, Python/FastAPI)

The only thing in the system with filesystem write access to `services/artifacts-server/artifacts/`. Exists so the AI agent (or anything else) manipulates artifacts through a narrow, validated API rather than touching disk directly.

**Endpoints:**
```
POST /tools/write-artifact   { slug, roles, files: {path: content} }  → creates or overwrites an artifact (writes manifest.json + every file)
GET  /tools/read-artifact?slug=...                                    → { slug, roles, files } or 404
GET  /health
```

**Structure:**
- `app/services/artifact_writer.py` — `ArtifactWriterService`: validates `slug`/file paths against path traversal (rejects `..`, confines every resolved path to `ARTIFACTS_ROOT`), requires `index.html` among the written files, writes `manifest.json` from `roles`
- `app/routers/tools.py` — FastAPI router, maps `InvalidArtifactError` → 400, missing artifact → 404
- `app/config.py` — `PORT` (default `5001`), `ARTIFACTS_ROOT` (default `../artifacts-server/artifacts`, i.e. the same folder `artifacts-server` serves from)

Registered as a plain Nx `project.json` (not a package.json-based JS project) with `install` / `serve` / `start` targets running `pip install` / `uvicorn` directly — Nx auto-discovers any `project.json` in the repo regardless of language.

---

## 5. `services/agent-service` (port 5002, Python/FastAPI)

Takes a natural-language chat prompt, asks an LLM to produce a complete artifact (or an updated version of one), and calls `tool-service` to persist it.

**Endpoints:**
```
GET  /agent/providers                          → { default, providers: [{id, label, model}] } — for populating a model picker
POST /agent/generate-artifact  { prompt, slug?, roles?, provider?, model? }  → one-shot create
POST /agent/chat  { messages, slug?, roles?, provider?, model? }             → multi-turn create/update, returns updated message history
GET  /health
```

**Multi-provider LLM abstraction** (`app/services/providers/`):
- `base.py` — `ArtifactLLMClient` ABC (`generate(messages, context_files) -> ArtifactSpec`), the shared JSON schema every provider is constrained to (`reply`, `slug`, `title`, `index_html`, `css`, `js`), and `build_system_prompt()`, which — when updating — folds the artifact's *current* files into the prompt so the model returns a complete, coherent replacement rather than a diff
- `claude_provider.py` — Anthropic Messages API, structured output via `output_config.format` (`json_schema`), adaptive thinking, streamed to avoid timeouts
- `gemini_provider.py` — `google-genai`, `response_schema=ArtifactSpec` (the same Pydantic model), `response.parsed` gives a typed result directly
- `factory.py` — `get_llm_client(provider, model_override, settings)` picks the implementation; `list_providers()` backs `GET /agent/providers`

Provider/model selection: `LLM_PROVIDER` env var (default `claude`) is the default; each request can override via `provider`/`model`. Per-provider model defaults also come from env: `ANTHROPIC_MODEL` (default `claude-opus-4-8`), `GEMINI_MODEL` (default `gemini-2.5-flash`), plus `GEMINI_API_KEY` (Claude's key resolves however the Anthropic SDK normally resolves it — env var, auth token, or CLI profile).

**Chat/update flow** (`app/services/chat_service.py`): if the request carries a `slug`, it first calls `tool-service`'s `read-artifact` to fetch the artifact's current files as context; the LLM returns a full replacement; `tool-service`'s `write-artifact` overwrites it (create and update are the same write call — there's no separate "patch" endpoint). The response includes the full updated message history so the Next.js chat page can just replace its local state with it.

Both the single-shot and chat flows share a small `artifact_persistence.py` helper so the "call the LLM → write via tool-service → build a preview URL" sequence isn't duplicated.

---

## 6. `apps/artifacts-viewer` (port 4200)

A Next.js (App Router) app that lets a user pick a role and an artifact, fetches a token, and renders the artifact in an isolated iframe.

**Request flow:**
1. Browser calls this app's own `GET /api/token?role=...` (same-origin, no CORS needed).
2. That Route Handler calls `backend-server`'s `/auth/dev-token` **server-side** (a BFF pattern — the browser never talks to `backend-server` directly, and `BACKEND_SERVICE_URL` never reaches the client bundle).
3. The token comes back to the browser, which builds `http://localhost:3000/<artifact-path>/?token=<jwt>` and sets it as the iframe `src` (a query param, not a header, because a plain iframe navigation can't attach `Authorization`).
4. `artifacts-server` validates the token and manifest exactly as described above and returns the artifact — or a JSON error, which just renders as text inside the frame.

**Modules:**
- `lib/config/env.ts` — `getBackendServiceUrl()` (server-only default `http://localhost:3334`), `getArtifactsServerUrl()` (public, default `http://localhost:3000`)
- `lib/api/backend-service-client.ts` — server-only (`import 'server-only'`) client for `backend-server`
- `app/api/token/route.ts` — the Route Handler bridging browser ↔ `backend-server`
- `lib/api/token-client.ts` — client-side fetch against this app's own `/api/token`
- `lib/artifacts/artifact-url.ts` — builds the token-bearing iframe URL
- `lib/artifacts/available-artifacts.ts` — static registry of known artifacts (`/dashboard/`, `/admin/users/`)
- `hooks/useArtifactToken.ts` — refetches the token whenever the selected role changes
- `components/RoleSwitcher.tsx`, `ArtifactSelector.tsx`, `ArtifactFrame.tsx`, `ArtifactViewer.tsx` — the UI, composed in `app/page.tsx`

**Iframe sandboxing** (`ArtifactFrame.tsx`) — artifacts are treated as untrusted content:
- `sandbox="allow-scripts"` **only** — no `allow-same-origin` (the framed document gets a unique opaque origin, so it can't read this app's — or even its own origin's — cookies/storage), no forms, popups, top-navigation, downloads, or modals.
- No `allow` (Permissions Policy) features are delegated.
- `referrerPolicy="no-referrer"` — this app's URL is never sent to the artifacts server as a `Referer` header.
- The iframe is keyed by `src`, so switching role or artifact fully remounts it rather than reusing stale state.

### AI chat page (`/chat`)

Lets a user create or update an artifact by chatting instead of hand-writing HTML. Reuses `RoleSwitcher` and `ArtifactFrame` from the main viewer for the live preview pane — same token flow, same sandboxing.

- `app/chat/page.tsx` → `components/chat/ChatPage.tsx` — owns the conversation state (`messages`, the target `slug`, selected `provider`, preview `role`)
- `components/chat/ChatMessageList.tsx`, `ChatComposer.tsx`, `ProviderSelector.tsx` — presentational pieces
- `lib/api/agent-service-client.ts` — server-only client for `agent-service` (mirrors `backend-service-client.ts`)
- `app/api/chat/route.ts`, `app/api/chat/providers/route.ts` — the BFF proxy (same reasoning as `/api/token`: the browser never talks to `agent-service` directly, and `AGENT_SERVICE_URL` stays server-only)
- `lib/api/chat-client.ts` — client-side fetch against those two routes
- `lib/chat/types.ts` — the wire types shared between the proxy and the UI

Flow: composer submits → optimistic user message appended → `POST /api/chat` with the full message list, the current `slug` (`null` on the first turn), and the selected provider → `agent-service` returns the assistant's reply plus the artifact's `url_path` → the page adopts the returned `slug`/`url_path` so the *next* message updates the same artifact instead of creating a new one, and the preview pane's iframe reloads against it.

---

## Running everything locally

```sh
npx nx serve backend-server       # http://localhost:3334
npx nx serve artifacts-server     # http://localhost:3000
npx nx run tool-service:serve     # http://localhost:5001 (needs `pip install -r services/tool-service/requirements.txt` first)
npx nx run agent-service:serve    # http://localhost:5002 (needs `pip install -r services/agent-service/requirements.txt`, and ANTHROPIC_API_KEY / GEMINI_API_KEY set to actually generate anything)
npx nx run artifacts-viewer:dev   # http://localhost:4200
```

Then open `http://localhost:4200` to browse existing artifacts by role, or `http://localhost:4200/chat` to create/update one via chat.

## Status

Everything above is implemented, builds, typechecks, lints, and has been verified end-to-end (token issuance → role-based 200/403/404 responses → sandboxed rendering; tool-service write/read round-trip against the real artifacts folder; the full agent-service → tool-service → artifacts-server chain, confirmed by writing and immediately serving an artifact; the chat page's proxy chain, confirmed against agent-service without live LLM credentials in this environment). Not yet built/verified: a real identity provider (the token endpoint is explicitly a *dev* stand-in), an artifact publishing/upload flow beyond the agent, e2e test suites (removed from this workspace for now), and an actual live Claude/Gemini generation — that requires `ANTHROPIC_API_KEY`/`GEMINI_API_KEY`, neither of which is set in this environment, so only the failure paths were exercised.
