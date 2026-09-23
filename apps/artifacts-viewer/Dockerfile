# syntax=docker/dockerfile:1
#
# Build context is the repo root — see docker-compose.yml.
# Build with: docker build -f apps/artifacts-viewer/Dockerfile .
#
# Next.js standalone output (see next.config.js) — a self-contained
# server.js plus a pruned node_modules, small enough not to need the full
# workspace node_modules tree in the runtime image.

FROM node:22-slim AS build
WORKDIR /workspace

# See services/tool-service/Dockerfile's identical comment: Prisma's
# generator shells out to `openssl version` to pick the right query-engine
# binary target, and node:22-slim doesn't have the CLI by default.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

COPY . .
# `npm ci` here fails on Linux: the repo's root package-lock.json was
# generated on Windows and is missing a `@swc/helpers` resolution entry
# that only shows up when npm resolves the Linux-specific @swc/core
# optional binary. `npm install` tolerates that gap by re-resolving instead
# of demanding an exact match — verified during this pass; see
# containerization report.
RUN npm install

# @prisma/client's generated code (custom output path — see
# apps/artifacts-viewer/prisma/schema.prisma) is imported by this app's own
# TypeScript source, so it must exist before Next.js's build/type-check step
# runs — same ordering as services/tool-service/Dockerfile.
RUN npx prisma generate --schema=apps/artifacts-viewer/prisma/schema.prisma

RUN npx nx run artifacts-viewer:build --configuration=production

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# See the build stage's comment — this is the copy of `openssl` that
# actually matters: it's this stage's `prisma generate` call (below) that
# produces the query-engine binary shipped in the final image.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

# Standalone output mirrors the monorepo path (outputFileTracingRoot is the
# repo root), so server.js lands at .next/standalone/apps/artifacts-viewer/.
COPY --from=build --chown=node:node /workspace/apps/artifacts-viewer/.next/standalone/ ./
# .next/static and public/ are NOT included in the standalone trace and must
# be copied in manually (Next.js's own documented standalone deployment
# step), at the same nested path server.js expects them at.
COPY --from=build --chown=node:node /workspace/apps/artifacts-viewer/.next/static/ ./apps/artifacts-viewer/.next/static/
COPY --from=build --chown=node:node /workspace/apps/artifacts-viewer/public/ ./apps/artifacts-viewer/public/
# Next's output file tracing only bundles packages this app's server code
# actually imports — the `prisma` CLI (used below only for `migrate
# deploy`, never imported by app code) isn't one of them, so its schema/
# migrations and the CLI itself are brought in explicitly instead.
COPY --from=build --chown=node:node /workspace/apps/artifacts-viewer/prisma/ ./apps/artifacts-viewer/prisma/

# Installing prisma/@prisma-client directly into /app (e.g. with a plain
# `npm install` here) is unsafe: the standalone COPY above ships no
# package.json (Next's standalone output doesn't emit one at this nested
# monorepo path), so npm would auto-generate an empty one for /app and then
# prune every already-traced package it doesn't recognize as extraneous —
# including `next` itself, breaking the server (verified: `next` is present
# in node_modules right after the COPY above, and gone after a plain
# `npm install` here). Installing into a scratch directory and merging the
# result into /app/node_modules avoids touching the already-traced tree.
RUN mkdir /tmp/prisma-install \
    && npm --prefix /tmp/prisma-install init -y >/dev/null \
    && npm --prefix /tmp/prisma-install install --no-audit --no-fund prisma@6.19.3 @prisma/client@6.19.3 \
    && cp -an /tmp/prisma-install/node_modules/. ./node_modules/ \
    && rm -rf /tmp/prisma-install \
    && npx prisma generate --schema=./apps/artifacts-viewer/prisma/schema.prisma \
    && chown -R node:node /app

USER node

ENV PORT=4200
ENV HOSTNAME=0.0.0.0
# Next's build bundles/traces this app's server code, including the custom-
# output Prisma client above (it lives under src/, not node_modules/, so it
# can't be marked a `serverExternalPackages` entry the way `@prisma/client`
# normally would be — that option only externalizes real node_modules
# packages). Bundling corrupts the client's __dirname-relative native query-
# engine lookup at runtime: it hunts a doubled/wrong path
# (.../apps/artifacts-viewer/apps/artifacts-viewer/...) and fails with
# PrismaClientInitializationError even though the .so.node file the
# `prisma generate` step above produced is sitting right there on disk.
# PRISMA_QUERY_ENGINE_LIBRARY is Prisma's own documented override
# (https://pris.ly/d/engine-not-found-nextjs) for exactly this bundler-
# tracing failure mode — it's checked before any auto-detection, so it
# sidesteps the broken lookup entirely. The absolute path below is fixed by
# this Dockerfile's own COPY/generate steps, so it's stable across builds.
ENV PRISMA_QUERY_ENGINE_LIBRARY=/app/apps/artifacts-viewer/src/generated/prisma-client/libquery_engine-debian-openssl-3.0.x.so.node
EXPOSE 4200

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
  CMD node -e "fetch('http://localhost:4200/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrations apply automatically on every container start, not as a separate
# manual deploy step — same pattern as services/tool-service/Dockerfile.
CMD ["sh", "-c", "npx prisma migrate deploy --schema=./apps/artifacts-viewer/prisma/schema.prisma && node apps/artifacts-viewer/server.js"]
