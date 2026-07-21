'use client';

import type { ArtifactCatalogEntry } from '../lib/artifacts/types';

export interface ArtifactSelectorProps {
  artifacts: ArtifactCatalogEntry[];
  artifactPath: string;
  onChange: (path: string) => void;
}

export function ArtifactSelector({ artifacts, artifactPath, onChange }: ArtifactSelectorProps) {
  if (artifacts.length === 0) {
    return <span style={{ color: '#888' }}>No artifacts available for this role.</span>;
  }

  return (
    <label>
      Artifact:{' '}
      <select value={artifactPath} onChange={(e) => onChange(e.target.value)}>
        {artifacts.map((artifact) => (
          <option key={artifact.slug} value={`/${artifact.slug}/`}>
            {artifact.title}
          </option>
        ))}
      </select>
    </label>
  );
}
