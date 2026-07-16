'use client';

import { AVAILABLE_ARTIFACTS } from '../lib/artifacts/available-artifacts';

export interface ArtifactSelectorProps {
  artifactPath: string;
  onChange: (path: string) => void;
}

export function ArtifactSelector({ artifactPath, onChange }: ArtifactSelectorProps) {
  return (
    <label>
      Artifact:{' '}
      <select value={artifactPath} onChange={(e) => onChange(e.target.value)}>
        {AVAILABLE_ARTIFACTS.map((artifact) => (
          <option key={artifact.path} value={artifact.path}>
            {artifact.label}
          </option>
        ))}
      </select>
    </label>
  );
}
