import type { ArtifactCatalogEntry } from '../artifacts/types';
import type { ChatResponsePayload } from '../chat/types';

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

/** Edits an existing artifact's content via opencode, driven by a free-text prompt — this app's
 *  own /api/artifacts/[...slug] BFF route's POST handler, which forwards to artifact-agent-service.
 *  Client-side. */
export async function editArtifactRequest(slug: string, prompt: string, accessToken: string): Promise<ChatResponsePayload> {
  const encodedPath = slug.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`/api/artifacts/${encodedPath}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
    signal: AbortSignal.timeout(950_000),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new CatalogRequestError(body.error || `Failed to edit artifact (status ${response.status})`);
  }

  return response.json();
}
