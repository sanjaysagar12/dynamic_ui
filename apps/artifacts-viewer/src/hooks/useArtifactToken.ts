'use client';

import { useEffect, useState } from 'react';
import type { Role } from '@org/shared-auth';
import { fetchToken, TokenRequestError } from '../lib/api/token-client';

export interface UseArtifactTokenResult {
  token: string | null;
  loading: boolean;
  error: string | null;
}

/** Fetches a fresh JWT whenever the selected role changes. */
export function useArtifactToken(role: Role): UseArtifactTokenResult {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetchToken(role, controller.signal)
      .then((newToken) => {
        setToken(newToken);
        setLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof TokenRequestError ? err.message : 'Failed to fetch token');
        setToken(null);
        setLoading(false);
      });

    return () => controller.abort();
  }, [role]);

  return { token, loading, error };
}
