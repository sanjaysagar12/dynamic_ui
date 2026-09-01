import { resolve } from 'path';
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: resolve(__dirname, '../.env') });

export interface AppConfig {
  port: number;
  databaseUrl: string;
  jwtSecret: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: Number(env.PORT) || 5104,
    databaseUrl: env.DATABASE_URL || '',
    jwtSecret: env.JWT_SECRET || '',
  };
}
