import { readdir, readFile } from 'fs/promises';
import { join, relative, sep } from 'path';
import type { Role } from '@org/shared-auth';
import { parseManifest } from '../core/manifest.js';
import { MANIFEST_FILENAME } from '../manifest/manifest-repository.js';

export interface ArtifactCatalogEntry {
  slug: string;
  title: string;
  roles: Role[];
}

export class ArtifactCatalogService {
  constructor(private readonly artifactsRoot: string) {}

  async list(): Promise<ArtifactCatalogEntry[]> {
    const entries = await this.walk(this.artifactsRoot);
    return entries.sort((a, b) => a.slug.localeCompare(b.slug));
  }

  private async walk(dir: string): Promise<ArtifactCatalogEntry[]> {
    const manifestPath = join(dir, MANIFEST_FILENAME);

    try {
      const raw = await readFile(manifestPath, 'utf-8');
      const manifest = parseManifest(JSON.parse(raw));
      const slug = relative(this.artifactsRoot, dir).split(sep).join('/');

      if (!slug) {
        return [];
      }

      return [{ slug, title: manifest.title ?? slug, roles: manifest.roles }];
    } catch {
      // No manifest.json here — recurse into subdirectories looking for artifacts.
    }

    let dirents;
    try {
      dirents = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }

    const results: ArtifactCatalogEntry[] = [];
    for (const dirent of dirents) {
      if (dirent.isDirectory()) {
        results.push(...(await this.walk(join(dir, dirent.name))));
      }
    }
    return results;
  }
}
