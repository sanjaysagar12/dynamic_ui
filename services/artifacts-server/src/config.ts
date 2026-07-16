import { resolve } from 'path';

export interface AppConfig {
  port: number;
  artifactsRoot: string;
  jwt: {
    secret: string;
    issuer: string;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: Number(env.PORT) || 3000,
    artifactsRoot: resolve(env.ARTIFACTS_ROOT || resolve(__dirname, '../artifacts')),
    jwt: {
      secret: env.JWT_SECRET || 'dev-insecure-shared-secret',
      issuer: env.JWT_ISSUER || 'backend-server',
    },
  };
}
