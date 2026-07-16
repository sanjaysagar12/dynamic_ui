import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = createApp(config);

const server = app.listen(config.port, () => {
  console.log(`artifacts-server listening at http://localhost:${config.port}`);
  console.log(`Serving artifacts from ${config.artifactsRoot}`);
});
server.on('error', console.error);
