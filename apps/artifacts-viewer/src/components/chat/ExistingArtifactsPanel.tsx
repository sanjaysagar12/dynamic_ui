'use client';

import type { ArtifactCatalogEntry } from '../../lib/artifacts/types';

export interface ExistingArtifactsPanelProps {
  artifacts: ArtifactCatalogEntry[];
  activeSlug: string | null;
  onRead: (artifact: ArtifactCatalogEntry) => void;
  onEdit: (artifact: ArtifactCatalogEntry) => void;
}

export function ExistingArtifactsPanel({ artifacts, activeSlug, onRead, onEdit }: ExistingArtifactsPanelProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      <span style={{ fontSize: '0.85rem', color: '#555' }}>Existing artifacts</span>
      {artifacts.length === 0 && <span style={{ fontSize: '0.85rem', color: '#888' }}>None for this role yet.</span>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        {artifacts.map((artifact) => (
          <li key={artifact.slug} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ flex: 1, fontWeight: artifact.slug === activeSlug ? 700 : 400 }}>{artifact.title}</span>
            <button type="button" onClick={() => onRead(artifact)}>
              Read
            </button>
            <button type="button" onClick={() => onEdit(artifact)}>
              Edit
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
