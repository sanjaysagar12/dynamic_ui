'use client';

import type { ArtifactCatalogEntry } from '../../lib/artifacts/types';
import { theme } from '../../lib/ui/theme';

export interface ExistingArtifactsPanelProps {
  artifacts: ArtifactCatalogEntry[];
  activeSlug: string | null;
  onRead: (artifact: ArtifactCatalogEntry) => void;
  onEdit: (artifact: ArtifactCatalogEntry) => void;
}

export function ExistingArtifactsPanel({ artifacts, activeSlug, onRead, onEdit }: ExistingArtifactsPanelProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      <span style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.05em', color: theme.color.textMuted, textTransform: 'uppercase' }}>
        Existing artifacts
      </span>
      {artifacts.length === 0 && <span style={{ fontSize: '0.85rem', color: theme.color.textMuted }}>None for this role yet.</span>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        {artifacts.map((artifact) => {
          const active = artifact.slug === activeSlug;
          return (
            <li
              key={artifact.slug}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.4rem 0.5rem',
                borderRadius: theme.radiusSm,
                background: active ? theme.color.primarySoft : 'transparent',
              }}
            >
              <span
                style={{
                  flex: 1,
                  fontSize: '0.85rem',
                  fontWeight: active ? 600 : 400,
                  color: active ? theme.color.primary : theme.color.text,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {artifact.title}
              </span>
              <button
                type="button"
                onClick={() => onRead(artifact)}
                style={{ border: 'none', background: 'none', color: theme.color.textMuted, cursor: 'pointer', fontSize: '0.8rem' }}
              >
                Read
              </button>
              <button
                type="button"
                onClick={() => onEdit(artifact)}
                style={{ border: 'none', background: 'none', color: theme.color.primary, cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
              >
                Edit
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
