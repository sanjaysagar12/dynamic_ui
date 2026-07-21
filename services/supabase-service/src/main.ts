import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = createApp(config);

const server = app.listen(config.port, () => {
  console.log(`supabase-service listening at http://localhost:${config.port}`);
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    console.warn(
      'SUPABASE_URL / SUPABASE_ANON_KEY are not set — /auth and /todos will return 503 until configured (see .env).',
    );
  }
});
server.on('error', console.error);
