import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = createApp(config);

app
  .listen({ port: config.port, host: '0.0.0.0' })
  .then(() => {
    console.log(`db-agent-service listening at http://localhost:${config.port}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
