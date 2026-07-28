import { resolve } from 'path';

export interface AppConfig {
  port: number;
  artifactsRoot: string;
  supabaseServiceUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: Number(env.PORT) || 3000,
    artifactsRoot: resolve(env.ARTIFACTS_ROOT || resolve(__dirname, '../artifacts')),
    supabaseServiceUrl: env.SUPABASE_SERVICE_URL || 'http://localhost:3335',
  };
}
