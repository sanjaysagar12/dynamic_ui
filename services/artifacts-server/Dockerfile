# syntax=docker/dockerfile:1
#
# Build context is the repo root — see docker-compose.yml.
# Build with: docker build -f services/artifacts-server/Dockerfile .

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
RUN npx nx run artifacts-server:build --configuration=production
RUN npx nx run artifacts-server:prune

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /workspace/services/artifacts-server/dist/ ./

# `npm install` (not `npm ci`) here: Nx's prune-lockfile output can pin a
# resolved version that doesn't satisfy this pruned package.json's own
# declared range, tripping npm ci's exact-sync check — see tool-service's
# Dockerfile for the concrete example this was found against.
RUN npm install --omit=dev && chown -R node:node /app

# Deliberately NOT copying services/artifacts-server/artifacts/ into this
# image. That directory (including AGENTS.md and .opencode/, which opencode
# needs) is runtime data living on the artifacts_data volume, shared with
# artifact-agent-service — see docker-compose.yml's top-of-file comment and
# artifact-agent-service's Dockerfile/entrypoint, which is what actually
# seeds those two files into the volume on first boot. Baking them into both
# service images independently would just create two copies that can drift.
#
# ARTIFACTS_ROOT must be set to that same volume's mount path (e.g.
# /app/artifacts) — set in docker-compose.yml, not baked in here.

# Pre-create the mount point owned by the non-root `node` user this image
# runs as, matching artifact-agent-service's Dockerfile — Docker copies an
# image directory's existing ownership onto a brand-new named volume the
# first time it's mounted there, whichever of the two containers gets there
# first, so both images need to agree on this ownership up front.
RUN mkdir -p /app/artifacts && chown node:node /app/artifacts

USER node
EXPOSE 3400

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://localhost:3400/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "main.js"]
