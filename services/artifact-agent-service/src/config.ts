import { resolve } from 'path';
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: resolve(__dirname, '../.env') });

// Provider/model switching was removed — opencode is always driven with this
// exact model (the `--model <provider>/<model>` flag, verified against
// `opencode models`). Change this constant, not an env var, to move models.
export const OPENCODE_MODEL = 'anthropic/claude-sonnet-5';

export interface AppConfig {
  port: number;
  artifactsServerUrl: string;
  artifactsRoot: string;
  opencodeBin: string;
  opencodeTimeoutMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const serviceRoot = resolve(__dirname, '..');
  return {
    // 5002 collided with another service already running on the same host — 5102 avoids it.
    port: Number(env.PORT) || 5102,
    artifactsServerUrl: env.ARTIFACTS_SERVER_URL || 'http://localhost:3400',

    // ANTHROPIC_API_KEY is not read here — opencode (a subprocess of this
    // service) resolves its own provider credentials directly from the
    // inherited environment / its own auth store.

    // opencode is what actually generates/edits artifact files now; see
    // services/artifact-agent-service/src/services/opencode-runner.ts.
    artifactsRoot: resolve(env.ARTIFACTS_ROOT || resolve(serviceRoot, '../artifacts-server/artifacts')),
    opencodeBin: env.OPENCODE_BIN || 'opencode',
    // A complex multi-screen artifact (role-based dashboards, several
    // tables/forms) can legitimately take 3-5+ minutes — this default gives
    // both this service and Node's fetch on the Next.js side real headroom
    // (see artifact-agent-service-client.ts).
    opencodeTimeoutMs: (Number(env.OPENCODE_TIMEOUT_SECONDS) || 900) * 1000,
  };
}
