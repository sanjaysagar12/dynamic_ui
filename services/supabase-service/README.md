# `supabase-service`

The **only** part of the system that talks to Supabase's data API at request time, and the
**only** place that turns a Supabase access token into a trusted identity + app role. It runs on
port `3335` by default.

Two things make this service the security boundary it is:

1. It holds **only the Supabase anon/publishable key** — never a secret/service-role key. Every
   read/write it makes to Postgres goes through a client scoped to the *caller's own* access
   token, so Postgres Row-Level Security (RLS) policies — not this service's own code — decide
   what a given caller can actually see or change.
2. No other service decodes or verifies a Supabase JWT itself. `artifacts-server`, `db-agent-service`,
   and the Next.js app's BFF routes all call this service's `/auth/verify` or `/data/:table`
   instead, so the Supabase project's auth configuration never has to be duplicated or trusted
   anywhere else.

## Endpoints

| Method | Path | Auth required | Body | Success response |
|---|---|---|---|---|
| `POST` | `/auth/signup` | none | `{ email, password }` | `{ accessToken, refreshToken, user, emailConfirmationRequired }` |
| `POST` | `/auth/login` | none | `{ email, password }` | same shape as signup |
| `POST` | `/auth/verify` | `Authorization: Bearer <token>` | none | `{ userId, email, role }` |
| `GET` | `/data/:table` | `Authorization: Bearer <token>` | none (query string: column filters, `order`, `limit`) | `{ data: [...] }` |
| `POST` | `/data/:table` | `Authorization: Bearer <token>` | `{ ...fields }` | the created row (bare object, `201`) |
| `PATCH` | `/data/:table/:id` | `Authorization: Bearer <token>` | `{ ...fields }` | the updated row (bare object) |
| `DELETE` | `/data/:table/:id` | `Authorization: Bearer <token>` | none | `204 No Content` |
| `GET` | `/health` | none | none | `{ status: "ok" }` |

`:table` is schema-agnostic — any table name matching `/^[a-zA-Z_][a-zA-Z0-9_]*$/` is accepted,
there is no hardcoded table list. This keeps the service usable for any project's schema without
code changes here.

### `POST /auth/signup` / `POST /auth/login`

Thin wrappers around `supabase-js`'s `auth.signUp` / `auth.signInWithPassword`, called on an
**anonymous** client (there's no existing session to scope these to — signing up/in is what
*creates* one). Returns Supabase's own session tokens directly; this service does not mint or
re-sign anything of its own. `emailConfirmationRequired: true` (no `accessToken`) means Supabase
is configured to require email confirmation before a session is issued — the caller must confirm
via email and then call `/auth/login`.

### `POST /auth/verify`

The core identity check every other service relies on (see `auth/auth.service.ts`):

1. `anonClient.auth.getUser(accessToken)` — asks Supabase's Auth API whether this token is a
   real, current, non-expired session. Anything else → `401`.
2. A client scoped to *that same token* (not a service-role bypass) runs
   `SELECT role FROM users WHERE id = <auth user id>` — RLS on the `users` table is what actually
   permits this read, not application code here. No matching row → `403` (a real Supabase Auth
   user exists, but has no corresponding row in this app's `users` table, so it isn't a
   recognized application user).
3. Returns `{ userId, email, role }`. Callers (e.g. `artifacts-server`) treat this as the one
   source of truth for "who is this and what can they do" — they never inspect the JWT themselves.

### `GET /data/:table` (list)

Every query-string key is treated as an exact-match column filter (`column = value`) **except**
two reserved keys: `order` (`column.asc` / `column.desc`) and `limit` (row count) — see
`data/records.service.ts`'s `list()`. Internally this is `client.from(table).select('*')` with
`.eq()` calls chained on for each filter, scoped to the caller's access token, so RLS decides
which rows actually come back. An empty `data: []` array is a normal, successful response — it's
indistinguishable from "RLS filtered every row out", by design (that's what makes RLS an actual
security boundary instead of a suggestion).

### `POST /data/:table` (create)

`client.from(table).insert(payload).select().single()` — inserts one row and returns it. RLS
`WITH CHECK` policies on the table can reject the insert outright (surfaces as a `400` with
Postgres's own error message).

### `PATCH /data/:table/:id` (update)

`client.from(table).update(patch).eq('id', id).select().single()` — always keyed on a column
literally named `id`. If RLS hides that row from this caller, or a `WITH CHECK` policy rejects
the new values, this comes back as an error rather than silently doing nothing.

### `DELETE /data/:table/:id`

`client.from(table).delete().eq('id', id)` — `204` on success (Supabase doesn't return the
deleted row here, so neither does this service).

## Auth on `/data/*`

Every route under `/data` runs behind `requireSupabaseAuth` (`auth/require-supabase-auth.ts`), a
`preHandler` hook that requires a well-formed `Authorization: Bearer <token>` header — it does
**not** itself validate the token against Supabase (that would cost an extra round-trip per data
call); it just extracts it and hands it to `RecordsService`, which attaches it to the Supabase
client it builds for that request. An invalid/expired/forged token simply fails whatever Postgres
call it's used for (Supabase's own JWT verification on its end rejects it), which surfaces as a
`400`-class error from `RecordsService` — it is not specially detected as "unauthenticated" here.
An optional `X-User-Id` header is accepted as passthrough metadata for callers that want it, but
nothing in this service currently reads it back out — the access token alone is what RLS keys on.

## Config (`src/config.ts`)

Read from `services/supabase-service/.env` via `dotenv`:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3335` | HTTP port this service listens on |
| `SUPABASE_URL` | *(required)* | `https://<project>.supabase.co` |
| `SUPABASE_ANON_KEY` | *(required)* | The **anon/publishable** key only — never a secret/service-role key |

If either `SUPABASE_URL` or `SUPABASE_ANON_KEY` is missing, every route that needs a Supabase
client throws `SupabaseNotConfiguredError`, surfaced as `503 Service Unavailable` — the service
still starts and `/health` still responds `200`, so a missing `.env` doesn't look like a crash
from the outside, just a clearly-labeled "not configured yet."

## Error shapes

Every error response is `{ "error": "<message>" }` with a real HTTP status code:

| Situation | Status |
|---|---|
| `SUPABASE_URL`/`SUPABASE_ANON_KEY` not set | `503` |
| Missing/malformed `Authorization` header on `/data/*` or `/auth/verify` | `401` |
| Invalid/expired access token (`/auth/verify`) | `401` |
| No `users` row for an otherwise-valid Supabase Auth user (`/auth/verify`) | `403` |
| Invalid table name, RLS rejection, or any other Postgres/PostgREST error | `400` |
| Anything unhandled that reaches `fastify.setErrorHandler` | whatever `err.statusCode` says, else `500` |

`middleware/error-handler.ts` is the catch-all registered via `fastify.setErrorHandler` — it logs
the full error server-side (`console.error`) before replying, so an unexpected failure is never
silently swallowed the way Fastify's own default error handler would otherwise leave it. Errors
the route handlers already recognize (`SupabaseNotConfiguredError`, `SupabaseRequestError`) are
converted to a response *inline* in each controller and never reach this catch-all.

## Logging

Every request now logs a one-line summary on completion (method, path, and outcome) via plain
`console.log`/`console.warn`/`console.error` calls placed in the controllers and services
themselves — this mirrors the plain-`console.*` convention already used by `main.ts` and
`middleware/error-handler.ts`, rather than switching to Fastify's built-in structured logger.
Passwords are never logged; email addresses and user ids are, since they're already part of the
request/response contract itself.

## Structure

```
src/
  main.ts                          Boots the Fastify app, logs the listening address + config warnings
  app.ts                           Wires services/routes together, registers /health + /auth + /data
  config.ts                        Reads PORT / SUPABASE_URL / SUPABASE_ANON_KEY from .env
  core/errors.ts                   SupabaseNotConfiguredError, SupabaseRequestError
  middleware/error-handler.ts      Catch-all fastify.setErrorHandler
  supabase/supabase-client-factory.ts  Builds anon-key-only supabase-js clients (anonymous or user-scoped)
  auth/
    auth.service.ts                signUp / signIn / verify against Supabase Auth
    auth.controller.ts             Fastify routes for /auth/signup, /auth/login, /auth/verify
    require-supabase-auth.ts       preHandler hook requiring Authorization: Bearer <token>
  data/
    records.service.ts             Generic list/create/update/remove proxy over any table
    records.controller.ts          Fastify routes for GET/POST/PATCH/DELETE /data/:table[/:id]
```
