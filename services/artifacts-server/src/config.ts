import { resolve } from 'path';

export interface AppConfig {
  port: number;
  artifactsRoot: string;
  supabaseServiceUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    // 3000 is a very commonly-claimed port on shared hosts (other apps/containers often default
    // to it too) — 3400 was picked specifically to avoid that collision. Override via PORT if
    // this still conflicts in a given environment.
    port: Number(env.PORT) || 3400,
    artifactsRoot: resolve(env.ARTIFACTS_ROOT || resolve(__dirname, '../artifacts')),
    supabaseServiceUrl: env.SUPABASE_SERVICE_URL || 'http://localhost:3335',
  };
}
