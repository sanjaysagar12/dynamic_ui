import { join } from 'node:path';
import { render } from 'ink';
import { findWorkspaceRoot } from './discovery/workspace-root.js';
import { ProcessManager } from './process/manager.js';
import { App } from './ui/App.js';

const workspaceRoot = findWorkspaceRoot(process.cwd());
const manager = new ProcessManager(workspaceRoot, join(workspaceRoot, '.devctl', 'logs'));

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await manager.stopAll();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});

const { waitUntilExit } = render(
  <App workspaceRoot={workspaceRoot} manager={manager} onQuit={shutdown} />
);

await waitUntilExit();
