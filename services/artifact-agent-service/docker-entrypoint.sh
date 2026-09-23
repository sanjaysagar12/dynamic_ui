#!/bin/sh
set -e

# opencode reads ANTHROPIC_API_KEY directly from the process environment at
# invocation time — no login step, no config file write required. This
# script's job is to verify that's actually true before handing off to the
# real service, not to script `opencode auth login` (which is interactive
# only and cannot be automated).

# There is deliberately no ANTHROPIC_MODEL (or similar) env var here.
# Provider/model switching was removed from this service: opencode always
# runs with a fixed model, OPENCODE_MODEL in src/config.ts (currently
# 'anthropic/claude-sonnet-5'). EXPECTED_MODEL below is a hand-kept copy of
# that same constant's model name (without the "anthropic/" provider
# prefix) — if you change OPENCODE_MODEL in config.ts, update this line too.
EXPECTED_MODEL="claude-sonnet-5"

if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "FATAL: ANTHROPIC_API_KEY is not set. opencode cannot authenticate to Anthropic." >&2
  exit 1
fi

echo "Verifying opencode recognizes the configured Anthropic credentials..."
if ! opencode auth list 2>&1 | grep -qi "anthropic"; then
  echo "FATAL: opencode does not recognize an Anthropic credential. Check ANTHROPIC_API_KEY." >&2
  exit 1
fi

echo "Verifying configured model 'anthropic/$EXPECTED_MODEL' is a real Anthropic model..."
if ! opencode models anthropic 2>&1 | grep -qx "anthropic/$EXPECTED_MODEL"; then
  echo "FATAL: 'anthropic/$EXPECTED_MODEL' is not in opencode's known model list." >&2
  echo "Run 'opencode models anthropic' to see valid values, and update both" >&2
  echo "OPENCODE_MODEL in src/config.ts and EXPECTED_MODEL in this script." >&2
  exit 1
fi

echo "opencode is correctly configured for anthropic/$EXPECTED_MODEL."

if [ -z "$ARTIFACTS_ROOT" ]; then
  echo "FATAL: ARTIFACTS_ROOT is not set — it must point at the shared artifacts volume mount (see docker-compose.yml)." >&2
  exit 1
fi

# Seed the shared artifacts volume with AGENTS.md / .opencode/ / _shared/ on
# first boot only — a fresh named volume starts empty, and these must exist
# before the first chat turn. Baked into this image at build time (see
# Dockerfile), copied into the volume here rather than requiring a separate
# manual step. _shared/ holds the vendored offline Tailwind build every
# generated artifact links (see AGENTS.md) — without it artifacts render
# unstyled, since the CSP blocks any CDN fallback.
if [ ! -f "$ARTIFACTS_ROOT/AGENTS.md" ]; then
  echo "Seeding artifacts volume with AGENTS.md and .opencode/ (first boot)..."
  mkdir -p "$ARTIFACTS_ROOT"
  cp /app/artifact-seed/AGENTS.md "$ARTIFACTS_ROOT/AGENTS.md"
  cp -r /app/artifact-seed/.opencode "$ARTIFACTS_ROOT/.opencode"
fi
if [ ! -d "$ARTIFACTS_ROOT/_shared" ]; then
  echo "Seeding artifacts volume with _shared/ (first boot)..."
  mkdir -p "$ARTIFACTS_ROOT"
  cp -r /app/artifact-seed/_shared "$ARTIFACTS_ROOT/_shared"
fi

# exec replaces this shell process with the real one, so Docker's SIGTERM
# on `docker stop` reaches the Node process directly for a clean shutdown.
exec "$@"
