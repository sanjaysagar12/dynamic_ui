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

COPY . .
# `npm ci` here fails on Linux: the repo's root package-lock.json was
# generated on Windows and is missing a `@swc/helpers` resolution entry
# that only shows up when npm resolves the Linux-specific @swc/core
# optional binary. `npm install` tolerates that gap by re-resolving instead
# of demanding an exact match — verified during this pass; see
# containerization report.
RUN npm install
RUN npx nx run artifacts-viewer:build --configuration=production

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Standalone output mirrors the monorepo path (outputFileTracingRoot is the
# repo root), so server.js lands at .next/standalone/apps/artifacts-viewer/.
COPY --from=build --chown=node:node /workspace/apps/artifacts-viewer/.next/standalone/ ./
# .next/static and public/ are NOT included in the standalone trace and must
# be copied in manually (Next.js's own documented standalone deployment
# step), at the same nested path server.js expects them at.
COPY --from=build --chown=node:node /workspace/apps/artifacts-viewer/.next/static/ ./apps/artifacts-viewer/.next/static/
COPY --from=build --chown=node:node /workspace/apps/artifacts-viewer/public/ ./apps/artifacts-viewer/public/

USER node

ENV PORT=4200
ENV HOSTNAME=0.0.0.0
EXPOSE 4200

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
  CMD node -e "fetch('http://localhost:4200/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/artifacts-viewer/server.js"]
