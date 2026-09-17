'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchArtifactCatalog, CatalogRequestError } from '../lib/api/catalog-client';
import type { ArtifactCatalogEntry } from '../lib/artifacts/types';

export interface UseArtifactCatalogResult {
  artifacts: ArtifactCatalogEntry[];
  /** The caller's own role, as resolved by the Artifacts Server from the access token. */
  role: string | null;
  loading: boolean;
  error: string | null;
  /** Re-fetches the catalog on demand, e.g. after deleting an artifact — without a full page reload. */
  refetch: () => void;
}

/** Fetches the artifacts visible to the current session, refetching whenever the access token changes. */
export function useArtifactCatalog(accessToken: string | null): UseArtifactCatalogResult {
  const queryClient = useQueryClient();
  const queryKey = ['artifact-catalog', accessToken];

  const query = useQuery({
    queryKey,
    queryFn: () => fetchArtifactCatalog(accessToken as string),
    enabled: !!accessToken,
  });

  return {
    artifacts: query.data?.artifacts ?? [],
    role: query.data?.role ?? null,
    loading: query.isLoading && !!accessToken,
    error: query.error ? (query.error instanceof CatalogRequestError ? query.error.message : 'Failed to load artifacts') : null,
    refetch: () => queryClient.invalidateQueries({ queryKey }),
  };
}
