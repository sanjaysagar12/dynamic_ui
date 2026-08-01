import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = createApp(config);

app
  .listen({ port: config.port, host: '0.0.0.0' })
  .then(() => {
    console.log(`supabase-service listening at http://localhost:${config.port}`);
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      console.warn(
        'SUPABASE_URL / SUPABASE_ANON_KEY are not set — /auth and /todos will return 503 until configured (see .env).',
      );
    }
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
