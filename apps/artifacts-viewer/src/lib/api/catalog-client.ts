import type { Role } from '@org/shared-auth';
import type { ArtifactCatalogEntry } from '../artifacts/types';

export class CatalogRequestError extends Error {}

/** Fetches the list of artifacts visible to a role via this app's own /api/artifacts route. Client-side. */
export async function fetchArtifactCatalog(role: Role, signal?: AbortSignal): Promise<ArtifactCatalogEntry[]> {
  const response = await fetch(`/api/artifacts?role=${encodeURIComponent(role)}`, { signal });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new CatalogRequestError(body.error || `Failed to load artifacts (status ${response.status})`);
  }

  const data = await response.json();
  return data.artifacts ?? [];
}
