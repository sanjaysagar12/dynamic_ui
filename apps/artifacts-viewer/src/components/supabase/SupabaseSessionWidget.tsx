'use client';

import { useState } from 'react';
import { useSupabaseSession } from '../../lib/supabase/supabase-session-context';

export function SupabaseSessionWidget() {
  const { session, pending, error, info, login, signUp, logout } = useSupabaseSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  if (session) {
    return (
      <span style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        Supabase: <strong>{session.email}</strong>
        <button type="button" onClick={logout}>
          Log out
        </button>
      </span>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        login(email, password);
      }}
      style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', fontSize: '0.85rem' }}
    >
      <input
        type="email"
        placeholder="supabase email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{ width: '160px' }}
      />
      <input
        type="password"
        placeholder="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={{ width: '110px' }}
      />
      <button type="submit" disabled={pending}>
        Log in
      </button>
      <button type="button" disabled={pending} onClick={() => signUp(email, password)}>
        Sign up
      </button>
      {error && <span style={{ color: 'crimson' }}>{error}</span>}
      {info && <span style={{ color: '#0a7' }}>{info}</span>}
    </form>
  );
}
