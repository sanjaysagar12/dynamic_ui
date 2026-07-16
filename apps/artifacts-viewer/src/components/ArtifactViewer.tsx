'use client';

import { useState } from 'react';
import type { Role } from '@org/shared-auth';
import { useArtifactToken } from '../hooks/useArtifactToken';
import { buildArtifactUrl } from '../lib/artifacts/artifact-url';
import { RoleSwitcher } from './RoleSwitcher';
import { ArtifactSelector } from './ArtifactSelector';
import { ArtifactFrame } from './ArtifactFrame';

export function ArtifactViewer() {
  const [role, setRole] = useState<Role>('manager');
  const [artifactPath, setArtifactPath] = useState('/dashboard/');
  const { token, loading, error } = useArtifactToken(role);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header style={{ display: 'flex', gap: '2rem', alignItems: 'center', padding: '1rem' }}>
        <RoleSwitcher role={role} onChange={setRole} />
        <ArtifactSelector artifactPath={artifactPath} onChange={setArtifactPath} />
        <span>
          Current role: <strong>{role}</strong>
        </span>
      </header>

      <main style={{ flex: 1, position: 'relative' }}>
        {loading && <p style={{ padding: '1rem' }}>Loading token…</p>}
        {error && <p style={{ padding: '1rem', color: 'crimson' }}>{error}</p>}
        {token && !loading && !error && (
          <ArtifactFrame src={buildArtifactUrl(artifactPath, token)} title={artifactPath} />
        )}
      </main>
    </div>
  );
}
