import { readdir, readFile, rm, writeFile } from 'fs/promises';
import { join, relative, sep } from 'path';
import type { Role } from '@org/shared-auth';
import { parseManifest } from '../core/manifest.js';
import { MANIFEST_FILENAME } from '../manifest/manifest-repository.js';
import { ArtifactNotFoundError } from '../core/errors.js';

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

  /** Permanently deletes an artifact's directory. `slug` is only ever trusted once it matches an
   *  entry `list()` itself already walked and recognized as a real manifest-bearing artifact —
   *  never joined onto `artifactsRoot` directly — so this can't be used to remove an arbitrary
   *  path, unlike `ArtifactPathResolver`'s more permissive sub-path resolution for serving. */
  async remove(slug: string): Promise<void> {
    const entries = await this.list();
    const entry = entries.find((e) => e.slug === slug);
    if (!entry) {
      throw new ArtifactNotFoundError();
    }
    await rm(join(this.artifactsRoot, ...entry.slug.split('/')), { recursive: true, force: true });
  }

  /** Renames an artifact by rewriting `title` in its manifest.json, leaving `roles` (and any other
   *  fields) untouched. Same trust model as remove(): `slug` is only acted on once it matches a
   *  real entry from list(). manifest-repository.ts's cache (used by the content-serving path) is
   *  never consulted here and only ever holds `roles`/`title` for *authorization*, which doesn't
   *  read `title` at all — so a stale cached title there has no observable effect and isn't worth
   *  the coupling to invalidate. */
  async rename(slug: string, title: string): Promise<void> {
    const entries = await this.list();
    const entry = entries.find((e) => e.slug === slug);
    if (!entry) {
      throw new ArtifactNotFoundError();
    }

    const manifestPath = join(this.artifactsRoot, ...entry.slug.split('/'), MANIFEST_FILENAME);
    const raw = await readFile(manifestPath, 'utf-8');
    const manifest = parseManifest(JSON.parse(raw));
    const updated = { ...manifest, title };
    await writeFile(manifestPath, JSON.stringify(updated, null, 2) + '\n', 'utf-8');
  }

  private async walk(dir: string): Promise<ArtifactCatalogEntry[]> {
    const manifestPath = join(dir, MANIFEST_FILENAME);

    try {
      const raw = await readFile(manifestPath, 'utf-8');
      const manifest = parseManifest(JSON.parse(raw));
      const slug = relative(this.artifactsRoot, dir).split(sep).join('/');

      // Folders like `_shared` hold vendored assets (e.g. Tailwind CSS) served
      // through the same manifest-gated pipeline, but aren't browsable artifacts.
      if (!slug || slug.split('/').some((segment) => segment.startsWith('_'))) {
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
