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
 * The caller's own Supabase access token is forwarded as-is — the Artifacts
 * Server verifies it (via supabase-service) and resolves the role itself, so
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
