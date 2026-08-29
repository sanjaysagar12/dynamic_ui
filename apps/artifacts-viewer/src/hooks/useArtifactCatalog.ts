'use client';

import { useCallback, useEffect, useState } from 'react';
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
  const [artifacts, setArtifacts] = useState<ArtifactCatalogEntry[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    if (!accessToken) {
      setArtifacts([]);
      setRole(null);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetchArtifactCatalog(accessToken, controller.signal)
      .then((result) => {
        setArtifacts(result.artifacts);
        setRole(result.role);
        setLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof CatalogRequestError ? err.message : 'Failed to load artifacts');
        setArtifacts([]);
        setRole(null);
        setLoading(false);
      });

    return () => controller.abort();
  }, [accessToken, reloadNonce]);

  const refetch = useCallback(() => setReloadNonce((n) => n + 1), []);

  return { artifacts, role, loading, error, refetch };
}
