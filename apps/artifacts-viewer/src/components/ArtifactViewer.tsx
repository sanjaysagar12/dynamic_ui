'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSupabaseSession } from '../lib/supabase/supabase-session-context';
import { useArtifactCatalog } from '../hooks/useArtifactCatalog';
import { useArtifactSrc } from '../hooks/useArtifactSrc';
import { deleteArtifactRequest, renameArtifactRequest, CatalogRequestError } from '../lib/api/catalog-client';
import type { ArtifactCatalogEntry } from '../lib/artifacts/types';
import { ArtifactSelector } from './ArtifactSelector';
import { ArtifactFrame } from './ArtifactFrame';
import { SupabaseSessionWidget } from './supabase/SupabaseSessionWidget';
import { theme, secondaryButtonStyle } from '../lib/ui/theme';

export function ArtifactViewer() {
  const { session } = useSupabaseSession();
  const token = session?.accessToken ?? null;
  const [artifactPath, setArtifactPath] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [manageError, setManageError] = useState<string | null>(null);
  const { artifacts, role, loading: catalogLoading, error: catalogError, refetch } = useArtifactCatalog(token);
  const artifactSrc = useArtifactSrc(artifactPath, token);

  useEffect(() => {
    if (catalogLoading) return;
    const stillVisible = artifacts.some((a) => `/${a.slug}/` === artifactPath);
    if (!stillVisible) {
      setArtifactPath(artifacts.length > 0 ? `/${artifacts[0].slug}/` : '');
    }
  }, [artifacts, catalogLoading, artifactPath]);

  const handleRename = async (artifact: ArtifactCatalogEntry) => {
    if (!token) return;
    const nextTitle = window.prompt('Rename artifact', artifact.title)?.trim();
    if (!nextTitle || nextTitle === artifact.title) return;

    setManageError(null);
    try {
      await renameArtifactRequest(artifact.slug, nextTitle, token);
      refetch();
    } catch (err) {
      setManageError(err instanceof CatalogRequestError ? err.message : 'Failed to rename artifact');
    }
  };

  const handleDelete = async (artifact: ArtifactCatalogEntry) => {
    if (!token) return;
    if (!window.confirm(`Delete "${artifact.title}"? This can't be undone.`)) return;

    setManageError(null);
    try {
      await deleteArtifactRequest(artifact.slug, token);
      refetch();
    } catch (err) {
      setManageError(err instanceof CatalogRequestError ? err.message : 'Failed to delete artifact');
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', background: theme.color.bg }}>
      <aside
        style={{
          width: '260px',
          flexShrink: 0,
          borderRight: `1px solid ${theme.color.border}`,
          background: theme.color.surface,
          display: 'flex',
          flexDirection: 'column',
          padding: '1rem',
          gap: '1rem',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <span
            style={{
              fontSize: '0.75rem',
              fontWeight: 700,
              letterSpacing: '0.05em',
              color: theme.color.textMuted,
              textTransform: 'uppercase',
            }}
          >
            Pages
          </span>
          {token ? (
            <ArtifactSelector
              artifacts={artifacts}
              artifactPath={artifactPath}
              onChange={setArtifactPath}
              onRename={handleRename}
              onDelete={handleDelete}
              canManage={role === 'OWNER'}
            />
          ) : (
            <span style={{ color: theme.color.textMuted, fontSize: '0.9rem' }}>Log in to see available pages.</span>
          )}
          {manageError && <p style={{ color: theme.color.danger, fontSize: '0.8rem', margin: 0 }}>{manageError}</p>}
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <Link href="/chat" style={{ fontSize: '0.9rem', fontWeight: 600, color: theme.color.primary, textDecoration: 'none' }}>
            Artifact Chat →
          </Link>
          <Link href="/db-chat" style={{ fontSize: '0.9rem', fontWeight: 600, color: theme.color.primary, textDecoration: 'none' }}>
            Database Chat →
          </Link>
        </nav>

        <div style={{ borderTop: `1px solid ${theme.color.border}`, paddingTop: '0.85rem' }}>
          <SupabaseSessionWidget role={role} popupPlacement="above" />
        </div>
      </aside>

      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {!token && <p style={{ padding: '1rem', color: theme.color.textMuted }}>Log in with Supabase to view artifacts.</p>}
          {token && catalogError && <p style={{ padding: '1rem', color: theme.color.danger }}>{catalogError}</p>}
          {token && catalogLoading && <p style={{ padding: '1rem', color: theme.color.textMuted }}>Loading artifacts…</p>}
          {token && !catalogLoading && artifacts.length === 0 && !catalogError && (
            <p style={{ padding: '1rem', color: theme.color.textMuted }}>No artifacts available for role &quot;{role}&quot;.</p>
          )}
          {artifactSrc && (
            <>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  padding: '0.5rem 1rem',
                  borderBottom: `1px solid ${theme.color.border}`,
                }}
              >
                <button type="button" onClick={() => setReloadKey((k) => k + 1)} style={secondaryButtonStyle}>
                  ⟳ Refresh
                </button>
              </div>
              <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
                <ArtifactFrame src={artifactSrc} title={artifactPath} reloadNonce={reloadKey} />
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
