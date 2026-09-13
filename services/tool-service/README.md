# `tool-service`

Fastify + Prisma app — the only service holding a database credential, and
the sole authority on "who is this caller and what role do they have". See
the root [ARCHITECTURE.md](../../ARCHITECTURE.md#3-servicestool-service-port-5104)
for the full design write-up (endpoints, the plugin tool registry, JWT
identity, `withAuditedTransaction`) and the root [README.md](../../README.md)
for running the whole workspace.

## Testing

Two automated layers live in this project today (see `ARCHITECTURE.md`'s
"Planned test layout" table):

- **Layer 1** (`test/db/`) — database invariants: constraints/triggers in
  `prisma/migrations` and `prisma/inventory_guards.sql`, exercised directly
  with raw SQL (no Prisma, no tool layer).
- **Layer 2** (`test/tools/`, `test/http/`) — the tool layer: each tool's
  handler function called in-process, and the same behaviors exercised again
  over real HTTP against a running app, to catch bugs the HTTP router
  introduces that calling a handler directly can't see.

Both layers use one shared piece of infrastructure (`test/infra/`): a fresh,
disposable Testcontainers Postgres per test **file**, migrated with the real
`prisma migrate deploy` + `inventory_guards.sql` — never a shared or
long-lived database, so tests can't leak state into each other across runs.

| Command | What it does | How it does it |
|---|---|---|
| `npm run test:layer2:tools` | Runs every Layer 2 in-process test — calls each tool's handler function directly against a real Postgres, with no HTTP server involved. Fastest feedback loop for tool logic (business rules, error codes, audit coverage). | Spins up one Testcontainers Postgres per test file (`test/infra/testDatabase.ts`, shared with Layer 1's own infra), applies migrations + `inventory_guards.sql`, then calls `tool.handler(ctx, args)` directly — no Fastify server, no HTTP. Each test file's writes land in that file's own throwaway database (not run inside a shared rolled-back transaction the way Layer 1 is, since some assertions — e.g. audit-coverage's row counts — need to see real committed rows). |
| `npm run test:layer2:http` | Runs the HTTP-contract suite — the same tool behaviors, but called over real HTTP against a running `tool-service` instance. Catches bugs the router introduces that the in-process suite structurally can't see: a wrong status code, a swallowed error code, an auth/role check applied to the wrong branch, a leaked internal error detail. | Boots the actual production Fastify app (`src/app.ts`'s `createApp()` — the same entry point `src/main.ts`/`npm start` uses, not a reimplementation) in-process, with its Prisma client swapped for that file's own Testcontainers Postgres client and `JWT_SECRET` fixed to a known test value, listening on an ephemeral port (`PORT: 0`) so files can run in parallel without colliding. Driven with `supertest`, making real HTTP requests against that address. |
| `npm run test:layer2` | Runs both of the above in sequence — the full Layer 2 gate. | Just chains the two commands; fails fast if the (faster) in-process suite fails before spending time booting the HTTP suite. |

**Which one should I run?**
- Changed a tool handler's logic (a new precondition, a new error code, a new
  field)? → `npm run test:layer2:tools` first — it's faster and pinpoints the
  handler directly.
- Changed `src/http/tools.router.ts`, `src/auth/jwt.ts`, or anything about
  how a request maps to a handler call (auth, the `confirmed` gate, error
  serialization)? → `npm run test:layer2:http` — the in-process suite calls
  handlers directly and can't see router-level bugs at all.
- Before opening a PR touching either → `npm run test:layer2`.

Layer 1 (`test/db/`) isn't wired up with its own `npm run` script yet — run
it directly with `npx jest test/db` (or `npx nx test tool-service` for the
whole project, which also picks up Layer 1/2/`test/smoke.test.ts` together).

### Known, deliberate gaps documented by these tests

- `test/tools/list-rows-scoping.test.ts` **intentionally passes** today to
  document a known gap: `list_rows` has no per-caller row scoping yet (see
  the `// TODO(phase-2): audit and add per-table ownership scoping` comment
  in `src/tools/plugins/list_rows.ts`). If that test starts *failing*, it
  means scoping was added — see the comment at the top of that file before
  changing the test to match.

### Notes for anyone extending Layer 2

- `test/infra/testApp.ts`'s `buildTestApp()` accepts an optional second
  `ToolRegistry` argument, used by exactly one spec
  (`test/http/auth-and-confirmation.test.ts`'s forged-role test) to boot a
  second, isolated app instance whose registry holds only a throwaway
  fixture tool — never added to `src/tools/tools.enabled.json`, unreachable
  by any real caller. Reach for this only when you need to prove a
  mechanism (e.g. role-gating) that no *shipped* tool currently exercises.
- `test/tools/audit-coverage.test.ts` builds its list of tools to check by
  reading the live registry (`mutates === true`, and excluding
  `requiresAuth: false` tools like `register` — those always run with
  `ctx.userId: null` in the real router, so they structurally can't satisfy
  this file's "actorId matches the calling test user" assertion), not a
  hardcoded array — so it keeps covering new mutating tools automatically.
  Adding a new mutating, auth-required tool means adding a matching entry
  to that file's `ARGS_BUILDERS` map; the file has its own test that fails
  loudly if the two drift apart.
