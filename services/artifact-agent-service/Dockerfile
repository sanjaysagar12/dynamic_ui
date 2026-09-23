# syntax=docker/dockerfile:1
#
# Build context is the repo root — see docker-compose.yml.
# Build with: docker build -f services/artifact-agent-service/Dockerfile .
#
# This is the one service that shells out to opencode as a real subprocess,
# and shares its ARTIFACTS_ROOT with artifacts-server via a volume — see
# docker-compose.yml's top-of-file comment.

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
RUN npx nx run artifact-agent-service:build --configuration=production
RUN npx nx run artifact-agent-service:prune

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# opencode-ai is not a dependency of any package.json in this repo (it's
# expected to be on PATH already in local dev, per the README's
# `npm i -g opencode-ai@latest`). Installing it globally here — rather than
# adding it as a project dependency with an uncertain node_modules/.bin
# PATH story — matches that same expectation and is verified immediately
# below, in the same layer, so the build fails loudly if it ever doesn't.
RUN npm install -g opencode-ai@latest && opencode --version

COPY --from=build --chown=node:node /workspace/services/artifact-agent-service/dist/ ./
# Staged seed content for the shared artifacts volume — copied into
# $ARTIFACTS_ROOT by docker-entrypoint.sh on first boot only. This is NOT
# the same as baking artifacts/ into the served image (see
# artifacts-server/Dockerfile's note); it exists solely so a fresh, empty
# named volume has these two files before the first chat turn runs.
COPY --from=build --chown=node:node /workspace/services/artifacts-server/artifacts/AGENTS.md ./artifact-seed/AGENTS.md
COPY --from=build --chown=node:node /workspace/services/artifacts-server/artifacts/.opencode/ ./artifact-seed/.opencode/
# _shared/ (vendored offline Tailwind build) is also required before the
# first chat turn — AGENTS.md instructs every generated artifact to link
# ../_shared/tailwind.min.css, and the CSP blocks any CDN fallback.
COPY --from=build --chown=node:node /workspace/services/artifacts-server/artifacts/_shared/ ./artifact-seed/_shared/

# `npm install` (not `npm ci`) here: Nx's prune-lockfile output can pin a
# resolved version that doesn't satisfy this pruned package.json's own
# declared range, tripping npm ci's exact-sync check — see tool-service's
# Dockerfile for the concrete example this was found against.
RUN npm install --omit=dev && chown -R node:node /app

# Pre-create the ARTIFACTS_ROOT mount point owned by the non-root `node`
# user this image runs as. Docker copies an image directory's existing
# ownership onto a brand-new named volume the first time it's mounted there
# — without this, a fresh artifacts_data volume mounts root-owned, and the
# entrypoint's seeding step (running as `node`) fails with EACCES.
RUN mkdir -p /app/artifacts && chown node:node /app/artifacts

COPY --chmod=755 services/artifact-agent-service/docker-entrypoint.sh /app/docker-entrypoint.sh

USER node
EXPOSE 5102

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://localhost:5102/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "main.js"]
