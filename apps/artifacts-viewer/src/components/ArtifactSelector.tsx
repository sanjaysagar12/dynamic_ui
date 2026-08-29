'use client';

import type { ArtifactCatalogEntry } from '../lib/artifacts/types';
import { theme } from '../lib/ui/theme';

export interface ArtifactSelectorProps {
  artifacts: ArtifactCatalogEntry[];
  artifactPath: string;
  onChange: (path: string) => void;
  onRename: (artifact: ArtifactCatalogEntry) => void;
  onDelete: (artifact: ArtifactCatalogEntry) => void;
  /** Only OWNER can rename/delete (enforced for real by the Artifacts Server) — hide both buttons
   *  for everyone else rather than show actions that would just 403. */
  canManage: boolean;
}

export function ArtifactSelector({ artifacts, artifactPath, onChange, onRename, onDelete, canManage }: ArtifactSelectorProps) {
  if (artifacts.length === 0) {
    return <span style={{ color: theme.color.textMuted, fontSize: '0.9rem' }}>No artifacts available for this role.</span>;
  }

  return (
    <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
      {artifacts.map((artifact) => {
        const path = `/${artifact.slug}/`;
        const active = path === artifactPath;
        return (
          <div
            key={artifact.slug}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem',
              borderRadius: theme.radiusSm,
              background: active ? theme.color.primarySoft : 'transparent',
            }}
          >
            <button
              type="button"
              onClick={() => onChange(path)}
              style={{
                flex: 1,
                minWidth: 0,
                textAlign: 'left',
                padding: '0.5rem 0.75rem',
                border: 'none',
                background: 'none',
                color: active ? theme.color.primary : theme.color.text,
                fontWeight: active ? 600 : 400,
                fontSize: '0.9rem',
                cursor: 'pointer',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {artifact.title}
            </button>
            {canManage && (
              <>
                <button
                  type="button"
                  onClick={() => onRename(artifact)}
                  style={{ border: 'none', background: 'none', color: theme.color.primary, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, padding: '0.25rem' }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(artifact)}
                  style={{ border: 'none', background: 'none', color: theme.color.danger, cursor: 'pointer', fontSize: '0.78rem', padding: '0.25rem 0.5rem 0.25rem 0' }}
                >
                  Delete
                </button>
              </>
            )}
          </div>
        );
      })}
    </nav>
  );
}
