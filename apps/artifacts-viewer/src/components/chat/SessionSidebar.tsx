'use client';

import type { ChatSessionSummaryDto } from '../../lib/chat-sessions/types';
import { theme, primaryButtonStyle } from '../../lib/ui/theme';

export interface SessionSidebarProps {
  sessions: ChatSessionSummaryDto[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (session: ChatSessionSummaryDto) => void;
  onDelete: (session: ChatSessionSummaryDto) => void;
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** A sidebar list of the caller's past chat sessions — same visual convention as
 *  ArtifactSelector.tsx's sidebar list (a `nav` of rows, active row highlighted, inline
 *  rename/delete actions), so this reads as the same kind of list rather than a new pattern. */
export function SessionSidebar({ sessions, activeId, onSelect, onNew, onRename, onDelete }: SessionSidebarProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <button type="button" onClick={onNew} style={{ ...primaryButtonStyle, width: '100%' }}>
        + New chat
      </button>

      {sessions.length === 0 ? (
        <span style={{ color: theme.color.textMuted, fontSize: '0.85rem' }}>No past chats yet.</span>
      ) : (
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
          {sessions.map((session) => {
            const active = session.id === activeId;
            return (
              <div
                key={session.id}
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
                  onClick={() => onSelect(session.id)}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: '0.1rem',
                    textAlign: 'left',
                    padding: '0.5rem 0.75rem',
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <span
                    style={{
                      color: active ? theme.color.primary : theme.color.text,
                      fontWeight: active ? 600 : 400,
                      fontSize: '0.9rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: '100%',
                    }}
                  >
                    {session.title || 'Untitled chat'}
                  </span>
                  <span style={{ color: theme.color.textMuted, fontSize: '0.75rem' }}>{formatRelativeTime(session.updatedAt)}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onRename(session)}
                  style={{ border: 'none', background: 'none', color: theme.color.primary, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, padding: '0.25rem' }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(session)}
                  style={{ border: 'none', background: 'none', color: theme.color.danger, cursor: 'pointer', fontSize: '0.78rem', padding: '0.25rem 0.5rem 0.25rem 0' }}
                >
                  Delete
                </button>
              </div>
            );
          })}
        </nav>
      )}
    </div>
  );
}
