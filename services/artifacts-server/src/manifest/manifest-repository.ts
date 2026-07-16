import { readFile } from 'fs/promises';
import { join } from 'path';
import { parseManifest, type ArtifactManifest } from '../core/manifest.js';

const MANIFEST_FILENAME = 'manifest.json';

export class ManifestRepository {
  private readonly cache = new Map<string, ArtifactManifest>();

  constructor(private readonly cacheEnabled = true) {}

  async load(artifactDir: string): Promise<ArtifactManifest> {
    const cached = this.cache.get(artifactDir);
    if (cached && this.cacheEnabled) {
      return cached;
    }

    const raw = await readFile(join(artifactDir, MANIFEST_FILENAME), 'utf-8');
    const manifest = parseManifest(JSON.parse(raw));

    if (this.cacheEnabled) {
      this.cache.set(artifactDir, manifest);
    }

    return manifest;
  }
}

export { MANIFEST_FILENAME };
