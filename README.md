# Dynamic UI — Artifacts Platform

An Nx monorepo implementing an **Artifacts platform**: role-gated, sandboxed HTML/CSS/JS "artifacts" that can be hand-written or generated/updated by an AI agent (via [opencode](https://opencode.ai)) through a chat UI, with a security model that assumes artifact code may be adversarial (sandboxed iframe, CSP, `postMessage`-only data access, anon-key-only Supabase access with Row-Level Security as the real authorization boundary).

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for the full design write-up. This README covers getting it running.

## Services at a glance

| Service | Port | Stack | Purpose |
|---|---|---|---|
| `artifacts-server` | 3000 | Express | Serves artifacts (static files, role-gated by verifying the caller's Supabase token via `supabase-service`) |
| `supabase-service` | 3335 | Express | Anon-key-only middle layer to Supabase; also verifies Supabase access tokens for other services |
| `agent-service` | 5002 | FastAPI | Drives [opencode](https://opencode.ai) (as a subprocess) to generate/update artifacts via chat |
| `artifacts-viewer` | 4200 | Next.js | The app you open in a browser |

## Prerequisites

- Node.js 20+ and a package manager (this repo uses `npm`)
- Python 3.11+ with `pip`
- The [opencode](https://opencode.ai) CLI on `PATH` (`npm i -g opencode-ai@latest`), authenticated with at least one provider (`opencode auth login`, or `ANTHROPIC_API_KEY`/`GEMINI_API_KEY` in the environment) — this is what `agent-service` actually shells out to for artifact generation
- A Supabase project (free tier is fine) — required for login and any data-backed artifact

## First-time setup

```sh
npm install
```

Then, for the Python service:

```sh
npx nx run agent-service:install
```

### Environment variables

Each service reads its own `.env` file (already `.gitignore`d — never commit real keys). Create these if they don't already exist:

**`services/artifacts-server/.env`**
```
PORT=3000
SUPABASE_SERVICE_URL=http://localhost:3335
```

**`services/supabase-service/.env`** *(required — this is the login/data layer)*
```
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_ANON_KEY=<your anon/publishable key>
PORT=3335
```
Get these from your Supabase project's **Settings → API**. This service never needs — and must never be given — a secret/service-role key.

**`services/agent-service/.env`** *(required to use the AI chat page)*
```
LLM_PROVIDER=gemini
GEMINI_MODEL=gemini-2.5-flash
ANTHROPIC_MODEL=claude-opus-4-8
ARTIFACTS_SERVER_URL=http://localhost:3000
PORT=5002

# The get_schema tool opencode uses (services/artifacts-server/artifacts/.opencode/tool/get_schema.ts)
# needs these to look up your real Supabase schema:
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_SECRET_KEY=<your secret/service-role key>
```
`LLM_PROVIDER`/`*_MODEL` just pick which model opencode is told to use (`--model anthropic/<model>` or `--model google/<model>`) — actual provider credentials come from opencode's own auth (`opencode auth login`, or `ANTHROPIC_API_KEY`/`GEMINI_API_KEY` inherited from this process's environment). You can also pick the provider per-request from the chat page's model picker regardless of the default.

`SUPABASE_SECRET_KEY` is the **only** place in the whole system that should ever hold a Supabase secret key. It's used solely by the `get_schema` tool at artifact-generation time — never for any runtime data request.

## Running the services

Each runs independently — open a terminal per service (or background them), in roughly this order:

```sh
# 1. Data layer
npx nx run supabase-service:serve        # http://localhost:3335

# 2. Artifact serving
npx nx run artifacts-server:serve        # http://localhost:3000

# 3. AI agent (skip if you just want to browse hand-written artifacts)
npx nx run agent-service:serve           # http://localhost:5002

# 4. The app itself
npx nx run artifacts-viewer:dev          # http://localhost:4200
```

Then open **http://localhost:4200**:
- Log in with the Supabase widget (sign up with any email/password — it creates a real Supabase Auth user; your role comes from that user's row in the `users` table, not from anything you pick in the UI).
- Browse the artifacts your role can see, listed in the sidebar.
- Open **http://localhost:4200/chat** to create or update an artifact by chatting with the agent.

None of the services auto-restart on file changes except `artifacts-viewer` (Next.js dev server) and `agent-service` (uvicorn `--reload`). If you edit an `artifacts-server`/`supabase-service` source file, stop and re-run its `serve` command to pick up the change.

## Project layout

```
apps/artifacts-viewer/          Next.js app — the UI
services/artifacts-server/      Static artifact server (+ services/artifacts-server/artifacts/ holds the actual artifact files,
                                 plus the shared AGENTS.md / .opencode/tool/get_schema.ts opencode uses when authoring them)
services/supabase-service/      Anon-key-only Supabase middle layer + Supabase auth-token verification
services/agent-service/         Drives opencode (Python)
packages/shared-auth/           Shared Role types
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
