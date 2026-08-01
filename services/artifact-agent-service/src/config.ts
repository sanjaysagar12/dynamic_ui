import { resolve } from 'path';
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: resolve(__dirname, '../.env') });

export type Provider = 'claude' | 'gemini';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-4-8';
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

// Maps the public Provider literal to the prefix opencode expects in its
// `--model <provider>/<model>` flag (verified against `opencode models`).
export const PROVIDER_MODEL_PREFIX: Record<Provider, string> = { claude: 'anthropic', gemini: 'google' };

export interface AppConfig {
  port: number;
  artifactsServerUrl: string;
  defaultProvider: string;
  anthropicModel: string;
  geminiModel: string;
  artifactsRoot: string;
  opencodeBin: string;
  opencodeTimeoutMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const serviceRoot = resolve(__dirname, '..');
  return {
    port: Number(env.PORT) || 5002,
    artifactsServerUrl: env.ARTIFACTS_SERVER_URL || 'http://localhost:3000',

    defaultProvider: env.LLM_PROVIDER || 'gemini',
    anthropicModel: env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL,
    geminiModel: env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
    // ANTHROPIC_API_KEY / GEMINI_API_KEY are not read here — opencode (a
    // subprocess of this service) resolves its own provider credentials
    // directly from the inherited environment / its own auth store.

    // opencode is what actually generates/edits artifact files now; see
    // services/artifact-agent-service/src/services/opencode-runner.ts.
    artifactsRoot: resolve(env.ARTIFACTS_ROOT || resolve(serviceRoot, '../artifacts-server/artifacts')),
    opencodeBin: env.OPENCODE_BIN || 'opencode',
    // A complex multi-screen artifact (role-based dashboards, several
    // tables/forms) can legitimately take 3-5+ minutes — this default gives
    // both this service and Node's fetch on the Next.js side real headroom
    // (see agent-service-client.ts).
    opencodeTimeoutMs: (Number(env.OPENCODE_TIMEOUT_SECONDS) || 900) * 1000,
  };
}
