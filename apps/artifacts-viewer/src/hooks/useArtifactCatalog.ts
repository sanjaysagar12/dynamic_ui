'use client';

import { useEffect, useState } from 'react';
import type { Role } from '@org/shared-auth';
import { fetchArtifactCatalog, CatalogRequestError } from '../lib/api/catalog-client';
import type { ArtifactCatalogEntry } from '../lib/artifacts/types';

export interface UseArtifactCatalogResult {
  artifacts: ArtifactCatalogEntry[];
  loading: boolean;
  error: string | null;
}

/** Fetches the artifacts visible to a role, refetching whenever the role changes. */
export function useArtifactCatalog(role: Role): UseArtifactCatalogResult {
  const [artifacts, setArtifacts] = useState<ArtifactCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetchArtifactCatalog(role, controller.signal)
      .then((result) => {
        setArtifacts(result);
        setLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof CatalogRequestError ? err.message : 'Failed to load artifacts');
        setArtifacts([]);
        setLoading(false);
      });

    return () => controller.abort();
  }, [role]);

  return { artifacts, loading, error };
}
