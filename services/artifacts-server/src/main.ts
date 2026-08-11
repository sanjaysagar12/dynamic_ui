import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = createApp(config);

app
  .listen({ port: config.port, host: '0.0.0.0' })
  .then(() => {
    console.log(`artifacts-server listening at http://localhost:${config.port}`);
    console.log(`Serving artifacts from ${config.artifactsRoot}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
