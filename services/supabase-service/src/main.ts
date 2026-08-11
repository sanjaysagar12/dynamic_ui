// Entry point: reads config from .env, builds the Fastify app, and starts listening.
// This is the only file that actually starts the HTTP server — app.ts just builds it,
// which keeps createApp() usable from tests without binding a real port.
import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = createApp(config);

app
  .listen({ port: config.port, host: '0.0.0.0' })
  .then(() => {
    console.log(`supabase-service listening at http://localhost:${config.port}`);
    // Config is intentionally allowed to be missing at boot (the service still starts
    // and /health still responds 200) — but every /auth and /data route will fail with
    // 503 until it's set, so make that loud in the startup log instead of a silent trap.
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      console.warn(
        'SUPABASE_URL / SUPABASE_ANON_KEY are not set — /auth and /data will return 503 until configured (see .env).',
      );
    } else {
      console.log(`Configured against Supabase project: ${config.supabaseUrl}`);
    }
  })
  .catch((err) => {
    // Fastify.listen() rejecting almost always means the port is already in use, or
    // the host/port combination is invalid — either way there's no server to run.
    console.error('supabase-service failed to start:', err);
    process.exit(1);
  });
