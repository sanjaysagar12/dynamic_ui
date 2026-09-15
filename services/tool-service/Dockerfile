# syntax=docker/dockerfile:1
#
# Build context is the repo root (npm workspaces monorepo — see
# docker-compose.yml, which passes `context: .` for every service). Build
# with: docker build -f services/tool-service/Dockerfile .

FROM node:22-slim AS build
WORKDIR /workspace

# node:22-slim (Debian bookworm) has libssl3 as a transitive dependency but
# not the `openssl` CLI itself — Prisma's generator shells out to `openssl
# version` to pick the right query-engine binary target, and without it
# silently guesses wrong (seen as "Prisma failed to detect the libssl/
# openssl version... Defaulting to openssl-1.1.x" and, at runtime, a P1001
# "can't reach database server" even though the network path is fine — the
# wrong engine binary fails Postgres's SSL handshake). Installing the real
# `openssl` package is Prisma's own documented fix for this warning.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

COPY . .
# `npm ci` here (not in the runtime stage's fresh, per-service pruned
# lockfile) fails on Linux: the repo's root package-lock.json was generated
# on Windows and is missing a `@swc/helpers` resolution entry that only
# shows up when npm resolves the Linux-specific @swc/core optional binary.
# `npm install` tolerates that gap by re-resolving instead of demanding an
# exact match — verified during this pass; see containerization report.
RUN npm install

# @prisma/client's generated code is imported by this service's TypeScript
# source, so it must exist before `nx build`'s tsc step runs.
RUN npx prisma generate --schema=services/tool-service/prisma/schema.prisma

RUN npx nx run tool-service:build --configuration=production
# prune-lockfile + copy-workspace-modules (aliased as the `prune` target)
# turns dist/ into a self-contained deployable unit: main.js, a package.json
# pruned to only this service's actual runtime deps, a matching
# package-lock.json, and workspace_modules/ holding built copies of
# workspace-local deps like @org/shared-types.
RUN npx nx run tool-service:prune

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# See the build stage's comment — this is the copy of `openssl` that
# actually matters: it's this stage's `prisma generate` call (below) that
# produces the query-engine binary shipped in the final image.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

COPY --from=build --chown=node:node /workspace/services/tool-service/dist/ ./
# Needed at runtime for `prisma migrate deploy` (the container's own startup
# command, below) and to regenerate the Prisma client against this stage's
# freshly-installed @prisma/client.
COPY --from=build --chown=node:node /workspace/services/tool-service/prisma/ ./prisma/

# `npm install` (not `npm ci`) here too: Nx's prune-lockfile output can pin
# a resolved version (observed: zod) that doesn't satisfy this pruned
# package.json's own declared range, tripping npm ci's exact-sync check.
# Since this dist/ directory holds only this one service's pruned
# package.json (no sibling workspace packages to create ambiguity), a plain
# install resolves unambiguously to a version satisfying that same range.
RUN npm install --omit=dev \
    && npx prisma generate --schema=./prisma/schema.prisma \
    && chown -R node:node /app

USER node
EXPOSE 5104

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
  CMD node -e "fetch('http://localhost:5104/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrations apply automatically on every container start, not as a separate
# manual deploy step.
CMD ["sh", "-c", "npx prisma migrate deploy --schema=./prisma/schema.prisma && node main.js"]
