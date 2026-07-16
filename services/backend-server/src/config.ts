export interface AppConfig {
  port: number;
  jwt: {
    secret: string;
    issuer: string;
    expiresIn: `${number}${'s' | 'm' | 'h' | 'd'}`;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: Number(env.PORT) || 3334,
    jwt: {
      secret: env.JWT_SECRET || 'dev-insecure-shared-secret',
      issuer: env.JWT_ISSUER || 'backend-server',
      expiresIn: (env.JWT_EXPIRES_IN as AppConfig['jwt']['expiresIn']) || '1h',
    },
  };
}
