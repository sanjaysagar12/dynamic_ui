import 'server-only';
import { getArtifactsServerUrl } from '../config/env';
import { requestDevToken } from './backend-service-client';
import type { ArtifactCatalogEntry } from '../artifacts/types';

export class ArtifactsCatalogError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ArtifactsCatalogError';
  }
}

/** Lists artifacts visible to the given role, as reported by the Artifacts Server. Server-side only. */
export async function listArtifactsForRole(role: string): Promise<ArtifactCatalogEntry[]> {
  const { token } = await requestDevToken(role);

  const response = await fetch(new URL('/api/artifacts', getArtifactsServerUrl()), {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new ArtifactsCatalogError('Failed to list artifacts from artifacts server', response.status);
  }

  const data = await response.json();
  return data.artifacts;
}
