import { stat } from 'fs/promises';
import { dirname, join, resolve, sep } from 'path';
import { MANIFEST_FILENAME } from '../manifest/manifest-repository.js';
import { ArtifactNotFoundError } from '../core/errors.js';

const INDEX_FILE = 'index.html';

export interface ResolvedArtifactRequest {
  /** Absolute path of the file to serve. */
  filePath: string;
  /** Absolute path of the artifact directory that owns this file (contains manifest.json). */
  artifactDir: string;
  /** True when the request targeted a directory without a trailing slash. */
  requiresTrailingSlashRedirect: boolean;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export class ArtifactPathResolver {
  constructor(private readonly artifactsRoot: string) {
    this.artifactsRoot = resolve(artifactsRoot);
  }

  async resolve(requestPath: string): Promise<ResolvedArtifactRequest> {
    const segments = this.toSafeSegments(requestPath);

    if (segments.at(-1) === MANIFEST_FILENAME) {
      throw new ArtifactNotFoundError();
    }

    const candidate = this.withinRoot(join(this.artifactsRoot, ...segments));

    let candidateStat;
    try {
      candidateStat = await stat(candidate);
    } catch {
      throw new ArtifactNotFoundError();
    }

    let filePath: string;
    let requiresTrailingSlashRedirect = false;

    if (candidateStat.isDirectory()) {
      filePath = join(candidate, INDEX_FILE);
      if (!(await pathExists(filePath))) {
        throw new ArtifactNotFoundError();
      }
      requiresTrailingSlashRedirect = !requestPath.endsWith('/');
    } else {
      filePath = candidate;
    }

    const artifactDir = await this.findArtifactDir(dirname(filePath));

    return { filePath, artifactDir, requiresTrailingSlashRedirect };
  }

  private async findArtifactDir(startDir: string): Promise<string> {
    let currentDir = startDir;

    for (;;) {
      if (await pathExists(join(currentDir, MANIFEST_FILENAME))) {
        return currentDir;
      }

      if (currentDir === this.artifactsRoot) {
        break;
      }

      const parent = dirname(currentDir);
      if (parent === currentDir) {
        break;
      }
      currentDir = parent;
    }

    throw new ArtifactNotFoundError();
  }

  private toSafeSegments(requestPath: string): string[] {
    return requestPath
      .split('/')
      .map((segment) => decodeURIComponent(segment))
      .filter((segment) => segment.length > 0 && segment !== '.');
  }

  private withinRoot(candidate: string): string {
    const resolved = resolve(candidate);
    const rootWithSep = this.artifactsRoot.endsWith(sep) ? this.artifactsRoot : this.artifactsRoot + sep;

    if (resolved !== this.artifactsRoot && !resolved.startsWith(rootWithSep)) {
      throw new ArtifactNotFoundError();
    }

    return resolved;
  }
}
