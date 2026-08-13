import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function findWorkspaceRoot(startDir: string = process.cwd()): string {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, 'nx.json'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `Could not locate workspace root (nx.json) starting from ${startDir}`
      );
    }
    dir = parent;
  }
}
