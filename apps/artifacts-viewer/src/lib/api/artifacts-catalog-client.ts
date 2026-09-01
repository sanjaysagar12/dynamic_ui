import 'server-only';
import { getArtifactsServerUrl } from '../config/env';
import type { ArtifactCatalogEntry } from '../artifacts/types';

export class ArtifactsCatalogError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ArtifactsCatalogError';
  }
}

export interface ArtifactCatalogResult {
  role: string;
  artifacts: ArtifactCatalogEntry[];
}

/**
 * Lists artifacts visible to the caller, as reported by the Artifacts Server.
 * The caller's own session access token is forwarded as-is — the Artifacts
 * Server verifies it (via tool-service) and resolves the role itself, so
 * this layer never needs to know or choose a role. Server-side only.
 */
export async function listArtifacts(accessToken: string): Promise<ArtifactCatalogResult> {
  const response = await fetch(new URL('/api/artifacts', getArtifactsServerUrl()), {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new ArtifactsCatalogError('Failed to list artifacts from artifacts server', response.status);
  }

  return response.json();
}

/**
 * Permanently deletes an artifact via the Artifacts Server. Same auth pattern as listArtifacts —
 * the caller's own access token decides whether this is even allowed (OWNER-only, enforced there).
 */
export async function deleteArtifact(slug: string, accessToken: string): Promise<void> {
  const encodedPath = slug.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(new URL(`/api/artifacts/${encodedPath}`, getArtifactsServerUrl()), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ArtifactsCatalogError(body.error || 'Failed to delete artifact', response.status);
  }
}

/**
 * Renames an artifact (rewrites manifest.json's `title`) via the Artifacts Server. Same auth
 * pattern as deleteArtifact — OWNER-only, enforced there.
 */
export async function renameArtifact(slug: string, title: string, accessToken: string): Promise<void> {
  const encodedPath = slug.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(new URL(`/api/artifacts/${encodedPath}`, getArtifactsServerUrl()), {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
    cache: 'no-store',
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ArtifactsCatalogError(body.error || 'Failed to rename artifact', response.status);
  }
}
