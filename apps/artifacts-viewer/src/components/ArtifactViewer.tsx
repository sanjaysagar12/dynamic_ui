'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Role } from '@org/shared-auth';
import { useArtifactToken } from '../hooks/useArtifactToken';
import { useArtifactCatalog } from '../hooks/useArtifactCatalog';
import { useArtifactSrc } from '../hooks/useArtifactSrc';
import { RoleSwitcher } from './RoleSwitcher';
import { ArtifactSelector } from './ArtifactSelector';
import { ArtifactFrame } from './ArtifactFrame';
import { SupabaseSessionWidget } from './supabase/SupabaseSessionWidget';

export function ArtifactViewer() {
  const [role, setRole] = useState<Role>('manager');
  const [artifactPath, setArtifactPath] = useState('');
  const { token, loading, error } = useArtifactToken(role);
  const { artifacts, loading: catalogLoading, error: catalogError } = useArtifactCatalog(role);
  const artifactSrc = useArtifactSrc(artifactPath, token);

  useEffect(() => {
    if (catalogLoading) return;
    const stillVisible = artifacts.some((a) => `/${a.slug}/` === artifactPath);
    if (!stillVisible) {
      setArtifactPath(artifacts.length > 0 ? `/${artifacts[0].slug}/` : '');
    }
  }, [artifacts, catalogLoading, artifactPath]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header style={{ display: 'flex', gap: '2rem', alignItems: 'center', padding: '1rem', flexWrap: 'wrap' }}>
        <RoleSwitcher role={role} onChange={setRole} />
        <ArtifactSelector artifacts={artifacts} artifactPath={artifactPath} onChange={setArtifactPath} />
        <span>
          Current role: <strong>{role}</strong>
        </span>
        <SupabaseSessionWidget />
        <Link href="/chat" style={{ marginLeft: 'auto' }}>
          AI Chat →
        </Link>
      </header>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {catalogError && <p style={{ padding: '1rem', color: 'crimson' }}>{catalogError}</p>}
        {loading && <p style={{ padding: '1rem' }}>Loading token…</p>}
        {error && <p style={{ padding: '1rem', color: 'crimson' }}>{error}</p>}
        {!catalogLoading && artifacts.length === 0 && !catalogError && (
          <p style={{ padding: '1rem', color: '#888' }}>No artifacts available for role &quot;{role}&quot;.</p>
        )}
        {artifactSrc && (
          <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
            <ArtifactFrame src={artifactSrc} title={artifactPath} />
          </div>
        )}
      </main>
    </div>
  );
}
