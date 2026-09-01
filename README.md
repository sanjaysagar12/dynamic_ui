# Dynamic UI — Artifacts Platform

An Nx monorepo implementing an **Artifacts platform**: role-gated, sandboxed HTML/CSS/JS "artifacts" that can be hand-written or generated/updated by an AI agent (via [opencode](https://opencode.ai)) through a chat UI, with a security model that assumes artifact code may be adversarial (sandboxed iframe, CSP, `postMessage`-only data access, a single Prisma-backed credential behind app-layer role checks as the real authorization boundary).

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for the full design write-up. This README covers getting it running.

## Services at a glance

| Service | Port | Stack | Purpose |
|---|---|---|---|
| `artifacts-server` | 3400 | Fastify | Serves artifacts (static files, role-gated by verifying the caller's token via `tool-service`) |
| `tool-service` | 5104 | Fastify + Prisma | The only service holding a database credential; exposes login/register/whoami and a generic tool-call layer over Postgres |
| `artifact-agent-service` | 5102 | Fastify | Drives [opencode](https://opencode.ai) (as a subprocess) to generate/update artifacts via chat |
| `db-agent-service` | 5103 | Fastify | Answers natural-language database questions (and performs confirmed writes) via chat, by calling `tool-service`'s tool catalog under the caller's own JWT |
| `artifacts-viewer` | 4200 | Next.js | The app you open in a browser |

Ports were chosen to avoid the common defaults (`3000`, `5001`–`5003`, `8000`/`8001`, `9001`/`9002`, …) that other unrelated services/containers on a shared host frequently claim. If any of these still collide in your environment, override with the `PORT` env var (or `ARTIFACTS_SERVER_URL`/`ARTIFACT_AGENT_SERVICE_URL`/`DB_AGENT_SERVICE_URL`/`TOOL_SERVICE_URL` on the consuming side — see below).

The browser only ever talks to `artifacts-viewer`'s own origin — `artifacts-server`, both agent services, and `tool-service` are reached exclusively server-side, from `artifacts-viewer`'s Node process (or from each other). None of them need to be publicly reachable in a real deployment; only `artifacts-viewer` does.

## Prerequisites

- Node.js 20+ and a package manager (this repo uses `npm`)
- The [opencode](https://opencode.ai) CLI on `PATH` (`npm i -g opencode-ai@latest`), authenticated with at least one provider (`opencode auth login`, or `ANTHROPIC_API_KEY`/`GEMINI_API_KEY` in the environment) — this is what `artifact-agent-service` actually shells out to for artifact generation
- An `ANTHROPIC_API_KEY` in the environment — used directly (not via opencode) by `db-agent-service` to answer database questions
- A Postgres database (`DATABASE_URL`) — required for login and any data-backed artifact; `tool-service` owns the schema via Prisma (`services/tool-service/prisma/schema.prisma`)

## First-time setup

```sh
npm install
```

### Environment variables

Each service reads its own `.env` file (already `.gitignore`d — never commit real keys). Create these if they don't already exist:

**`services/tool-service/.env`** *(required — this is the login/data layer)*
```
DATABASE_URL=postgresql://<pooled-connection-string>
DIRECT_URL=postgresql://<direct-connection-string, used for migrations>
PORT=5104
JWT_SECRET=<a long random string>
```
`JWT_SECRET` signs and verifies every access token `login`/`register` mint — it's held only by this service. Run `npx prisma migrate deploy` (from `services/tool-service/`) against a fresh database before first use.

**`services/artifacts-server/.env`**
```
PORT=3400
TOOL_SERVICE_URL=http://localhost:5104
```

**`services/artifact-agent-service/.env`** *(required to use the Artifact Chat page)*
```
LLM_PROVIDER=gemini
GEMINI_MODEL=gemini-2.5-flash
ANTHROPIC_MODEL=claude-sonnet-5
ARTIFACTS_SERVER_URL=http://localhost:3400
PORT=5102

# Where opencode's get_tools tool (services/artifacts-server/artifacts/.opencode/tool/get_tools.ts)
# looks up the live tool catalog. Defaults to http://localhost:5104 if unset.
TOOL_SERVICE_URL=http://localhost:5104
```
`LLM_PROVIDER`/`*_MODEL` just pick which model opencode is told to use (`--model anthropic/<model>` or `--model google/<model>`) — actual provider credentials come from opencode's own auth (`opencode auth login`, or `ANTHROPIC_API_KEY`/`GEMINI_API_KEY` inherited from this process's environment). You can also pick the provider per-request from the chat page's model picker regardless of the default. This service holds no database credential of any kind — opencode looks up the live tool catalog through `get_tools` against `tool-service`'s open, metadata-only `GET /tools` endpoint instead of talking to a database directly.

**`services/db-agent-service/.env`** *(required to use the Database Chat page)*
```
PORT=5103
TOOL_SERVICE_URL=http://localhost:5104
ANTHROPIC_API_KEY=<your Anthropic API key>
DB_AGENT_MODEL=claude-sonnet-5
```
This service holds no database credential of its own — every read or write it makes goes through `tool-service`'s `POST /tools/:name/execute`, carrying the caller's own access token (passed in on each `/agent/chat-db` request) as the `Authorization` header. That's what keeps each tool's own role check and handler logic — not this agent — as the actual authority on what's allowed.

**`apps/artifacts-viewer/.env.local`** *(optional — only needed if a backend service isn't on its default `localhost` port, e.g. in a real deployment)*
```
ARTIFACTS_SERVER_URL=http://localhost:3400
ARTIFACT_AGENT_SERVICE_URL=http://localhost:5102
DB_AGENT_SERVICE_URL=http://localhost:5103
TOOL_SERVICE_URL=http://localhost:5104
```
All four are read server-side only (Next.js `.env.local`, not committed) — the browser never sees any of these URLs. Every request the browser makes goes to `artifacts-viewer`'s own origin (`/api/...`), which forwards to the right backend service from Node. That's what lets `artifacts-server`/`artifact-agent-service`/`db-agent-service`/`tool-service` stay private/internal-only in deployment: only `artifacts-viewer` needs to be publicly reachable.

## Running the services

### All at once (recommended)

```sh
npm run dev
```

Runs all five services in parallel in one terminal (via [`concurrently`](https://www.npmjs.com/package/concurrently)), each with its own colored, name-prefixed log output so you can tell them apart at a glance. `Ctrl+C` stops all of them together. This is exactly the set of commands listed individually below — the script just runs them concurrently instead of in separate terminals.

### Individually

Each runs independently — open a terminal per service (or background them), in roughly this order:

```sh
# 1. Data layer
npx nx run tool-service:serve            # http://localhost:5104

# 2. Artifact serving
npx nx run artifacts-server:serve        # http://localhost:3400

# 3. AI agents (skip either if you don't need it)
npx nx run artifact-agent-service:serve  # http://localhost:5102 — chat-artifact (opencode)
npx nx run db-agent-service:serve        # http://localhost:5103 — chat-db (database Q&A)

# 4. The app itself
npx nx run artifacts-viewer:dev          # http://localhost:4200
```

Running them individually is mainly useful when you want to restart just one service (see the note on auto-restart below) without taking the others down too.

Then open **http://localhost:4200**:
- Log in with the auth widget (register with any email/password — it creates a real account via `tool-service`'s `register` tool; your role comes from that account, not from anything you pick in the UI).
- Browse the artifacts your role can see, listed in the sidebar.
- Open **http://localhost:4200/chat** ("Artifact Chat") to create or update an artifact by chatting with the agent.
- Open **http://localhost:4200/db-chat** ("Database Chat") to ask natural-language questions about your data — answers (and any write) are scoped by whatever role each `tool-service` tool requires, same as everything else.

None of the services auto-restart on file changes except `artifacts-viewer` (Next.js dev server). If you edit an `artifacts-server`/`tool-service`/`artifact-agent-service`/`db-agent-service` source file, stop and re-run its `serve` command to pick up the change.

## Project layout

```
apps/artifacts-viewer/          Next.js app — the UI
services/artifacts-server/      Static artifact server (+ services/artifacts-server/artifacts/ holds the actual artifact files,
                                 plus the shared AGENTS.md / .opencode/tool/get_tools.ts opencode uses when authoring them)
services/tool-service/          The only service holding a database credential (Prisma) — login/register/whoami/list_rows/... as tools
services/artifact-agent-service/ Drives opencode to generate/update artifacts (chat-artifact)
services/db-agent-service/      Answers database questions over chat via tool-service's tool catalog (chat-db)
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
