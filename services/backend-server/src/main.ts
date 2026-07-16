import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = createApp(config);

const server = app.listen(config.port, () => {
  console.log(`backend-server listening at http://localhost:${config.port}`);
  console.log(`Issue a dev token: GET http://localhost:${config.port}/auth/dev-token?role=admin`);
});
server.on('error', console.error);
