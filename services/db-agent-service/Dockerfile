# syntax=docker/dockerfile:1
#
# Build context is the repo root — see docker-compose.yml.
# Build with: docker build -f services/db-agent-service/Dockerfile .
#
# No special requirements: this service calls the Anthropic SDK directly
# (ANTHROPIC_API_KEY) and tool-service's HTTP API — no subprocess, no
# filesystem/volume dependency.

FROM node:22-slim AS build
WORKDIR /workspace

COPY . .
# `npm ci` here (not in the runtime stage's fresh, per-service pruned
# lockfile) fails on Linux: the repo's root package-lock.json was generated
# on Windows and is missing a `@swc/helpers` resolution entry that only
# shows up when npm resolves the Linux-specific @swc/core optional binary.
# `npm install` tolerates that gap by re-resolving instead of demanding an
# exact match — verified during this pass; see containerization report.
RUN npm install
RUN npx nx run db-agent-service:build --configuration=production
RUN npx nx run db-agent-service:prune

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /workspace/services/db-agent-service/dist/ ./

# `npm install` (not `npm ci`) here: Nx's prune-lockfile output can pin a
# resolved version that doesn't satisfy this pruned package.json's own
# declared range, tripping npm ci's exact-sync check — see tool-service's
# Dockerfile for the concrete example this was found against.
RUN npm install --omit=dev && chown -R node:node /app

USER node
EXPOSE 5103

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://localhost:5103/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "main.js"]
