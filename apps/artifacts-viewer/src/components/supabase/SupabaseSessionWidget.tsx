'use client';

import { useState } from 'react';
import { useSupabaseSession } from '../../lib/supabase/supabase-session-context';
import { ProfileMenu } from './ProfileMenu';
import { theme, inputStyle, primaryButtonStyle, secondaryButtonStyle } from '../../lib/ui/theme';

export interface SupabaseSessionWidgetProps {
  /** Shown alongside the email once logged in — the current user's app role. */
  role?: string | null;
  /** Which side the logout popup opens toward. See ProfileMenu. */
  popupPlacement?: 'above' | 'below';
}

export function SupabaseSessionWidget({ role, popupPlacement }: SupabaseSessionWidgetProps) {
  const { session, pending, error, info, login, signUp, logout } = useSupabaseSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  if (session) {
    return <ProfileMenu email={session.email} role={role} onLogout={logout} popupPlacement={popupPlacement} />;
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        login(email, password);
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}
    >
      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={inputStyle}
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={inputStyle}
      />
      <div style={{ display: 'flex', gap: '0.4rem' }}>
        <button type="submit" disabled={pending} style={{ ...primaryButtonStyle, flex: 1 }}>
          Log in
        </button>
        <button type="button" disabled={pending} onClick={() => signUp(email, password)} style={{ ...secondaryButtonStyle, flex: 1 }}>
          Sign up
        </button>
      </div>
      {error && <span style={{ color: theme.color.danger, fontSize: '0.8rem' }}>{error}</span>}
      {info && <span style={{ color: theme.color.success, fontSize: '0.8rem' }}>{info}</span>}
    </form>
  );
}
