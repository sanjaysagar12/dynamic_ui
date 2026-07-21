# Dynamic UI — Artifacts Platform

An Nx monorepo implementing an **Artifacts platform**: role-gated, sandboxed HTML/CSS/JS "artifacts" that can be hand-written or generated/updated by an AI agent (Claude or Gemini) through a chat UI, with a security model that assumes artifact code may be adversarial (sandboxed iframe, CSP, `postMessage`-only data access, anon-key-only Supabase access with Row-Level Security as the real authorization boundary).

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for the full design write-up. This README covers getting it running.

## Services at a glance

| Service | Port | Stack | Purpose |
|---|---|---|---|
| `backend-server` | 3334 | Express | Issues development JWTs |
| `artifacts-server` | 3000 | Express | Serves artifacts (static files, role-gated) |
| `supabase-service` | 3335 | Express | Anon-key-only middle layer to Supabase |
| `tool-service` | 5001 | FastAPI | Writes/reads artifact files; holds the Supabase secret key for schema lookups |
| `agent-service` | 5002 | FastAPI | Generates/updates artifacts via Claude/Gemini |
| `artifacts-viewer` | 4200 | Next.js | The app you open in a browser |

## Prerequisites

- Node.js 20+ and a package manager (this repo uses `npm`)
- Python 3.11+ with `pip`
- A Supabase project (free tier is fine) if you want the data-backed artifacts (todo, etc.) to actually work — purely-local-state artifacts work without it

## First-time setup

```sh
npm install
```

Then, for each Python service, install its dependencies:

```sh
npx nx run tool-service:install
npx nx run agent-service:install
```

### Environment variables

Each service reads its own `.env` file (already `.gitignore`d — never commit real keys). Create these if they don't already exist:

**`services/backend-server/.env`** *(optional — has working defaults)*
```
JWT_SECRET=dev-insecure-shared-secret
JWT_ISSUER=backend-server
PORT=3334
```

**`services/artifacts-server/.env`** *(optional — has working defaults)*
```
JWT_SECRET=dev-insecure-shared-secret   # must match backend-server's
JWT_ISSUER=backend-server               # must match backend-server's
PORT=3000
```
> `JWT_SECRET`/`JWT_ISSUER` must be identical between `backend-server` (issues tokens) and `artifacts-server` (verifies them). If you don't set them, both fall back to the same hardcoded dev defaults, so this "just works" without any `.env` files at all — only set these if you want your own secret.

**`services/supabase-service/.env`** *(required for any data-backed artifact)*
```
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_ANON_KEY=<your anon/publishable key>
PORT=3335
```
Get these from your Supabase project's **Settings → API**. This service never needs — and must never be given — a secret/service-role key.

**`services/tool-service/.env`** *(required only for the AI agent's schema-lookup tool)*
```
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_SECRET_KEY=<your secret/service-role key>
```
This is the **only** place in the whole system that should ever hold a Supabase secret key. It's used solely by the `get-schema` tool at artifact-generation time — never for any runtime data request.

**`services/agent-service/.env`** *(required to use the AI chat page)*
```
LLM_PROVIDER=gemini
GEMINI_MODEL=gemini-2.5-flash
GEMINI_API_KEY=<your Gemini API key>
ANTHROPIC_MODEL=claude-opus-4-8
TOOL_SERVICE_URL=http://localhost:5001
ARTIFACTS_SERVER_URL=http://localhost:3000
PORT=5002
```
Set `LLM_PROVIDER=claude` to default to Claude instead (needs `ANTHROPIC_API_KEY` resolved however the Anthropic SDK normally finds it — env var, auth token, or CLI profile). You can also pick the provider per-request from the chat page's model picker regardless of the default.

## Running the services

Each runs independently — open a terminal per service (or background them), in roughly this order:

```sh
# 1. Identity
npx nx serve backend-server              # http://localhost:3334

# 2. Data layer (skip if you don't have a Supabase project yet)
npx nx run supabase-service:serve        # http://localhost:3335

# 3. Artifact storage + serving
npx nx run tool-service:serve            # http://localhost:5001
npx nx run artifacts-server:serve        # http://localhost:3000

# 4. AI agent (skip if you just want to browse hand-written artifacts)
npx nx run agent-service:serve           # http://localhost:5002

# 5. The app itself
npx nx run artifacts-viewer:dev          # http://localhost:4200
```

Then open **http://localhost:4200**:
- Pick a role (admin/manager) and browse the existing artifacts.
- To use data-backed artifacts (e.g. the todo app), log in with the Supabase widget in the header first (sign up with any email/password — it creates a real Supabase Auth user).
- Open **http://localhost:4200/chat** to create or update an artifact by chatting with the agent.

None of the services auto-restart on file changes except `artifacts-viewer` (Next.js dev server) and `agent-service`/`tool-service` (uvicorn `--reload`). If you edit a `backend-server`/`artifacts-server`/`supabase-service` source file, stop and re-run its `serve` command to pick up the change.

### Quick smoke test without the browser

```sh
curl "http://localhost:3334/auth/dev-token?role=admin"
# → { "token": "...", "role": "admin", "tokenType": "Bearer" }

curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/artifacts"
# → { "artifacts": [...] }
```

## Project layout

```
apps/artifacts-viewer/          Next.js app — the UI
services/artifacts-server/      Static artifact server (+ services/artifacts-server/artifacts/ holds the actual artifact files)
services/backend-server/        Dev JWT issuer
services/supabase-service/      Anon-key-only Supabase middle layer
services/tool-service/          Artifact file I/O + schema introspection (Python)
services/agent-service/         AI agent (Python)
packages/shared-auth/           Shared Role types + JWT signing/verification
```

Full details, request flows, and the security model: **[ARCHITECTURE.md](./ARCHITECTURE.md)**.

---

## Nx workspace basics

This repo is managed with [Nx](https://nx.dev). A few commands that come up often:

```sh
npx nx run <project>:<target>       # run any task for any project
npx nx run-many -t build,lint -p <project>   # run several targets for one project
npx nx graph                        # visually explore the project graph
npx nx sync                         # keep TypeScript project references up to date (auto-runs on build/typecheck)
```

[Nx documentation](https://nx.dev/docs) · [Nx Console (editor extension)](https://nx.dev/docs/getting-started/editor-setup)
