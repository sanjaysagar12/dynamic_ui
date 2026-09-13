import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();

if (!config.jwtSecret) {
  console.error('JWT_SECRET is not set — refusing to start (see .env.example).');
  process.exit(1);
}

const app = createApp(config);

app
  .listen({ port: config.port, host: '0.0.0.0' })
  .then(() => {
    console.log(`tool-service listening at http://localhost:${config.port}`);
  })
  .catch((err) => {
    console.error('tool-service failed to start:', err);
    process.exit(1);
  });
