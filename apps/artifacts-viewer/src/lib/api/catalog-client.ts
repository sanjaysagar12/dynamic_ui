import type { ArtifactCatalogEntry } from '../artifacts/types';

export class CatalogRequestError extends Error {}

export interface ArtifactCatalogResult {
  role: string;
  artifacts: ArtifactCatalogEntry[];
}

/** Fetches the artifacts visible to the current session via this app's own /api/artifacts route. Client-side. */
export async function fetchArtifactCatalog(accessToken: string, signal?: AbortSignal): Promise<ArtifactCatalogResult> {
  const response = await fetch('/api/artifacts', {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new CatalogRequestError(body.error || `Failed to load artifacts (status ${response.status})`);
  }

  return response.json();
}

/** Deletes an artifact via this app's own /api/artifacts/[...slug] BFF route. Client-side. */
export async function deleteArtifactRequest(slug: string, accessToken: string): Promise<void> {
  const encodedPath = slug.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`/api/artifacts/${encodedPath}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new CatalogRequestError(body.error || `Failed to delete artifact (status ${response.status})`);
  }
}

/** Renames an artifact via this app's own /api/artifacts/[...slug] BFF route. Client-side. */
export async function renameArtifactRequest(slug: string, title: string, accessToken: string): Promise<void> {
  const encodedPath = slug.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`/api/artifacts/${encodedPath}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new CatalogRequestError(body.error || `Failed to rename artifact (status ${response.status})`);
  }
}
