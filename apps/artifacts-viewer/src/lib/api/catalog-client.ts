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
