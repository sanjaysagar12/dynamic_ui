'use client';

import { useEffect, useRef, useState } from 'react';
import { theme } from '../../lib/ui/theme';

export interface ProfileMenuProps {
  email: string | null;
  role?: string | null;
  onLogout: () => void;
  /** Which side of the trigger the popup opens toward, so it stays on-screen
   *  whether this sits near the top of a panel or the bottom of a sidebar. */
  popupPlacement?: 'above' | 'below';
}

export function ProfileMenu({ email, role, onLogout, popupPlacement = 'below' }: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const initial = (email ?? '?').charAt(0).toUpperCase();

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
          width: '100%',
          padding: '0.5rem',
          border: `1px solid ${theme.color.border}`,
          borderRadius: theme.radius,
          background: theme.color.surface,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span
          style={{
            width: '28px',
            height: '28px',
            borderRadius: '50%',
            background: theme.color.primary,
            color: theme.color.primaryText,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.8rem',
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {initial}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              display: 'block',
              fontSize: '0.85rem',
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {email ?? 'Account'}
          </span>
          {role && <span style={{ display: 'block', fontSize: '0.75rem', color: theme.color.textMuted }}>{role}</span>}
        </span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            ...(popupPlacement === 'above' ? { bottom: 'calc(100% + 0.4rem)' } : { top: 'calc(100% + 0.4rem)' }),
            left: 0,
            width: '100%',
            minWidth: '220px',
            background: theme.color.surface,
            border: `1px solid ${theme.color.border}`,
            borderRadius: theme.radius,
            boxShadow: theme.shadow,
            padding: '0.5rem',
            zIndex: 20,
          }}
        >
          <div style={{ padding: '0.4rem 0.5rem' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, wordBreak: 'break-all' }}>{email}</div>
            {role && <div style={{ fontSize: '0.75rem', color: theme.color.textMuted, marginTop: '0.15rem' }}>Role: {role}</div>}
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            style={{
              width: '100%',
              marginTop: '0.35rem',
              padding: '0.5rem',
              border: 'none',
              borderRadius: theme.radiusSm,
              background: 'transparent',
              color: theme.color.danger,
              textAlign: 'left',
              cursor: 'pointer',
              fontSize: '0.85rem',
              fontWeight: 500,
            }}
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
