'use client';

import { useCallback, useEffect, useState } from 'react';

export interface ToolMeta {
  mutates: boolean;
  destructive: boolean;
}

interface ToolCatalogEntry extends ToolMeta {
  name: string;
}

interface ToolCatalogResponse {
  tools: ToolCatalogEntry[];
}

// Module-scope cache: the catalog is public, session-static metadata
// (tool-service's own GET /tools via app/api/tools/route.ts), not
// per-user data, so it's fetched once for the whole page rather than once
// per mounted hook instance/rerender. `inFlight` is cleared on failure (not
// cached as a permanent rejection) so a later mount can retry.
let cachedCatalog: Map<string, ToolMeta> | null = null;
let inFlight: Promise<Map<string, ToolMeta>> | null = null;

async function loadCatalog(): Promise<Map<string, ToolMeta>> {
  const res = await fetch('/api/tools');
  if (!res.ok) {
    throw new Error(`GET /api/tools returned ${res.status}`);
  }
  const body: ToolCatalogResponse = await res.json();
  const map = new Map<string, ToolMeta>();
  for (const tool of body.tools) {
    map.set(tool.name, { mutates: tool.mutates, destructive: tool.destructive });
  }
  return map;
}

/**
 * Fetches tool-service's tool catalog once per session (cached at module
 * scope, shared across every mount/rerender) and exposes lookup of a
 * single tool's mutate/destructive metadata.
 *
 * `getToolMeta` returning `undefined` means either the catalog hasn't
 * finished loading yet, or `name` genuinely isn't a real tool — callers
 * (useArtifactDataBridge.ts) MUST treat both cases as "requires
 * confirmation," never as "safe to skip it." This hook never resolves that
 * ambiguity itself; it only reports what it knows.
 */
export function useToolCatalog(): { getToolMeta: (name: string) => ToolMeta | undefined; loading: boolean } {
  const [catalog, setCatalog] = useState<Map<string, ToolMeta> | null>(cachedCatalog);
  const [loading, setLoading] = useState(cachedCatalog === null);

  useEffect(() => {
    if (cachedCatalog) {
      setCatalog(cachedCatalog);
      setLoading(false);
      return;
    }

    let cancelled = false;
    if (!inFlight) {
      inFlight = loadCatalog().catch((err) => {
        inFlight = null;
        throw err;
      });
    }

    inFlight
      .then((map) => {
        cachedCatalog = map;
        if (!cancelled) {
          setCatalog(map);
          setLoading(false);
        }
      })
      .catch(() => {
        // Fetch failed — leave `catalog` null (getToolMeta stays
        // fail-closed for every name) but stop reporting `loading`, since
        // it isn't going to resolve on its own without a fresh mount.
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const getToolMeta = useCallback((name: string) => catalog?.get(name), [catalog]);

  return { getToolMeta, loading };
}
