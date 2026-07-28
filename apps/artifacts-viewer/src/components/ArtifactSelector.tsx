'use client';

import type { ArtifactCatalogEntry } from '../lib/artifacts/types';
import { theme } from '../lib/ui/theme';

export interface ArtifactSelectorProps {
  artifacts: ArtifactCatalogEntry[];
  artifactPath: string;
  onChange: (path: string) => void;
}

export function ArtifactSelector({ artifacts, artifactPath, onChange }: ArtifactSelectorProps) {
  if (artifacts.length === 0) {
    return <span style={{ color: theme.color.textMuted, fontSize: '0.9rem' }}>No artifacts available for this role.</span>;
  }

  return (
    <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
      {artifacts.map((artifact) => {
        const path = `/${artifact.slug}/`;
        const active = path === artifactPath;
        return (
          <button
            key={artifact.slug}
            type="button"
            onClick={() => onChange(path)}
            style={{
              textAlign: 'left',
              padding: '0.5rem 0.75rem',
              border: 'none',
              borderRadius: theme.radiusSm,
              background: active ? theme.color.primarySoft : 'transparent',
              color: active ? theme.color.primary : theme.color.text,
              fontWeight: active ? 600 : 400,
              fontSize: '0.9rem',
              cursor: 'pointer',
            }}
          >
            {artifact.title}
          </button>
        );
      })}
    </nav>
  );
}
