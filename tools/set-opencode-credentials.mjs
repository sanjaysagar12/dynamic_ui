#!/usr/bin/env node
// Rotates the Anthropic credentials opencode uses when artifact-agent-service drives it
// (services/artifact-agent-service/src/services/opencode-runner.ts). The model itself
// (anthropic/claude-sonnet-5) is a fixed constant (OPENCODE_MODEL in config.ts) — there is no
// provider/model switching, so this script only ever touches credentials, never the model.
//
// There are two places a credential can live, not one:
//   1. ~/.local/share/opencode/auth.json — opencode's own credential store (`opencode auth
//      login` writes here). This is what the opencode subprocess actually authenticates with,
//      and it takes precedence over an inherited ANTHROPIC_API_KEY env var — so editing only
//      #2 below would silently do nothing as long as this file already has an Anthropic entry.
//   2. services/artifact-agent-service/.env — ANTHROPIC_API_KEY there is only a fallback
//      opencode uses if #1 has no stored Anthropic credential at all (see config.ts).
//
// Usage — pass the new key via an env var, not a CLI argument, so it doesn't end up in shell
// history or a process listing:
//   PowerShell:  $env:NEW_ANTHROPIC_API_KEY = "sk-ant-..."; node tools/set-opencode-credentials.mjs
//   bash:        NEW_ANTHROPIC_API_KEY="sk-ant-..." node tools/set-opencode-credentials.mjs
//
// Afterwards, restart artifact-agent-service — it reads .env once at startup, not on every
// request (see README.md's "None of the services auto-restart..." note).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const newKey = process.env.NEW_ANTHROPIC_API_KEY;
if (!newKey) {
  console.error('Set NEW_ANTHROPIC_API_KEY to the new key first — see the usage comment at the top of this script.');
  process.exit(1);
}

// 1. opencode's own credential store.
const authPath = join(homedir(), '.local', 'share', 'opencode', 'auth.json');
if (existsSync(authPath)) {
  const auth = JSON.parse(readFileSync(authPath, 'utf-8'));
  auth.anthropic = { type: auth.anthropic?.type ?? 'api', ...auth.anthropic, key: newKey };
  writeFileSync(authPath, JSON.stringify(auth, null, 2));
  console.log(`Updated the Anthropic key in ${authPath}`);
} else {
  console.warn(`No opencode auth.json at ${authPath} — run "opencode auth login" once first, then re-run this script.`);
}

// 2. services/artifact-agent-service/.env — fallback key, read by src/config.ts.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(repoRoot, 'services', 'artifact-agent-service', '.env');
let env = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : '';

function upsert(source, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  return pattern.test(source) ? source.replace(pattern, line) : `${source.trimEnd()}\n${line}\n`;
}

env = upsert(env, 'ANTHROPIC_API_KEY', newKey);
writeFileSync(envPath, env, 'utf-8');
console.log(`Updated ${envPath} (ANTHROPIC_API_KEY=<redacted>)`);

console.log('\nDone. Restart artifact-agent-service (and any running `opencode` sessions) to pick this up.');
