import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { ToolServiceClient } from './services/tool-service-client.js';
import { validatePostWriteHooks } from './services/post-write-hooks.js';

const config = loadConfig();

// Shared with createApp below so this doesn't construct a second ToolServiceClient (and a second,
// separate catalog cache) purely for this one startup check.
const toolService = new ToolServiceClient(config);
const app = createApp(config, toolService);

async function start(): Promise<void> {
  // Fail loudly before accepting any traffic if a post-write hook references a tool that no
  // longer exists, or a mutating one as a follow-up — same "refuse to start" pattern as
  // tool-service's ToolRegistry constructor (services/tool-service/src/tools/registry.ts).
  // Deliberately called with no jwt: validation must check hooks against the definitive full tool
  // set, not whatever one role's request happens to be filtered down to (see fetchToolCatalog).
  const catalog = await toolService.fetchToolCatalog();
  validatePostWriteHooks(catalog);

  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`db-agent-service listening at http://localhost:${config.port}`);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
