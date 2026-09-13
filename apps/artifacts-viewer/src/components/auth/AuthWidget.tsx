'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from '../../lib/session/session-context';
import { ProfileMenu } from './ProfileMenu';
import { theme, inputStyle, primaryButtonStyle, secondaryButtonStyle } from '../../lib/ui/theme';

export interface AuthWidgetProps {
  /** Shown alongside the email once logged in — the current user's app role. */
  role?: string | null;
  /** Which side the popup opens toward. See ProfileMenu. */
  popupPlacement?: 'above' | 'below';
}

type Mode = 'login' | 'register';

/**
 * Logged out: a chip that opens a small popup offering both a login and a
 * register form (toggleable) — tool-service has no external auth provider
 * with its own signup page, so this app owns that flow itself. Logged in:
 * the existing ProfileMenu (email/role/logout), unchanged.
 */
export function AuthWidget({ role, popupPlacement = 'below' }: AuthWidgetProps) {
  const { session, pending, error, login, register, logout } = useSession();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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

  // A successful login/register populates `session`, which switches this
  // component to the ProfileMenu branch below — reset the popup so a later
  // logout doesn't reopen it pre-filled with the last attempt's input.
  useEffect(() => {
    if (session) {
      setOpen(false);
      setEmail('');
      setPassword('');
    }
  }, [session]);

  if (session) {
    return <ProfileMenu email={session.email} role={role} onLogout={logout} popupPlacement={popupPlacement} />;
  }

  const handleSubmit = async () => {
    if (mode === 'login') {
      await login(email, password);
    } else {
      await register(email, password);
    }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen((v) => !v)} style={{ ...secondaryButtonStyle, width: '100%' }}>
        Log in / Register
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            ...(popupPlacement === 'above' ? { bottom: 'calc(100% + 0.4rem)' } : { top: 'calc(100% + 0.4rem)' }),
            left: 0,
            width: '100%',
            minWidth: '260px',
            background: theme.color.surface,
            border: `1px solid ${theme.color.border}`,
            borderRadius: theme.radius,
            boxShadow: theme.shadow,
            padding: '0.75rem',
            zIndex: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
          }}
        >
          <div style={{ display: 'flex', gap: '0.3rem' }}>
            <button
              type="button"
              onClick={() => setMode('login')}
              style={{
                ...(mode === 'login' ? primaryButtonStyle : secondaryButtonStyle),
                flex: 1,
                padding: '0.4rem',
                fontSize: '0.8rem',
              }}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => setMode('register')}
              style={{
                ...(mode === 'register' ? primaryButtonStyle : secondaryButtonStyle),
                flex: 1,
                padding: '0.4rem',
                fontSize: '0.8rem',
              }}
            >
              Register
            </button>
          </div>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await handleSubmit();
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}
          >
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputStyle}
              autoComplete="email"
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
            <button type="submit" disabled={pending} style={primaryButtonStyle}>
              {mode === 'login' ? 'Log in' : 'Create account'}
            </button>
            {error && <span style={{ color: theme.color.danger, fontSize: '0.8rem' }}>{error}</span>}
          </form>
        </div>
      )}
    </div>
  );
}
