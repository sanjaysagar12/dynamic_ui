import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const MANIFEST_FILE = 'manifest.json';

// Writes manifest.json directly — agent-service owns the artifacts_root
// filesystem the same way opencode does, so this no longer needs to go
// through a separate service. opencode never touches this file itself (see
// AGENTS.md); it only writes the content files.
export function writeManifest(artifactDir: string, roles: string[], title: string | null): void {
  const manifestPath = join(artifactDir, MANIFEST_FILE);
  const resolvedTitle = title || readTitle(artifactDir);
  const manifest: { roles: string[]; title?: string } = { roles };
  if (resolvedTitle) {
    manifest.title = resolvedTitle;
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
}

export function readTitle(artifactDir: string): string | null {
  const manifestPath = join(artifactDir, MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    return null;
  }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const title = manifest.title;
    return typeof title === 'string' && title ? title : null;
  } catch {
    return null;
  }
}
