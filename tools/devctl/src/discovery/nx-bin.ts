import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Resolves the Nx CLI's JS entrypoint directly instead of shelling out to
 * `npx nx`. On Windows, `npx` resolves to `npx.cmd`, and spawning through that
 * wrapper buffers the child's stdout/stderr almost indefinitely for
 * long-running (continuous) tasks like `serve` — logs never stream and
 * port-in-use checks race against output that hasn't arrived yet. Spawning
 * `node <nx.js>` directly avoids the wrapper and streams output immediately.
 */
export function resolveNxBin(workspaceRoot: string): string {
  const binPath = join(workspaceRoot, 'node_modules', 'nx', 'dist', 'bin', 'nx.js');
  if (!existsSync(binPath)) {
    throw new Error(`Could not find the Nx CLI at ${binPath}. Run "npm install" first.`);
  }
  return binPath;
}
