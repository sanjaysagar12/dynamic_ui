'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

export interface SupabaseSession {
  accessToken: string;
  userId: string;
  email: string | null;
}

export interface SupabaseSessionContextValue {
  session: SupabaseSession | null;
  pending: boolean;
  error: string | null;
  info: string | null;
  login: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const SupabaseSessionContext = createContext<SupabaseSessionContextValue | null>(null);

/**
 * Holds the parent app's Supabase session (obtained once, here) so it can be
 * handed to *any* artifact's iframe uniformly — artifacts don't each manage
 * their own login; they just receive a token + uid if one is available.
 */
export function SupabaseSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SupabaseSession | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const submit = async (endpoint: 'login' | 'signup', email: string, password: string) => {
    setPending(true);
    setError(null);
    setInfo(null);

    try {
      const response = await fetch(`/api/supabase/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Request failed (status ${response.status})`);
      }

      if (data.emailConfirmationRequired || !data.accessToken) {
        setInfo('Account created. Check your email to confirm it, then log in.');
        return;
      }

      setSession({ accessToken: data.accessToken, userId: data.user.id, email: data.user.email });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setPending(false);
    }
  };

  const value: SupabaseSessionContextValue = {
    session,
    pending,
    error,
    info,
    login: (email, password) => submit('login', email, password),
    signUp: (email, password) => submit('signup', email, password),
    logout: () => setSession(null),
  };

  return <SupabaseSessionContext.Provider value={value}>{children}</SupabaseSessionContext.Provider>;
}

export function useSupabaseSession(): SupabaseSessionContextValue {
  const ctx = useContext(SupabaseSessionContext);
  if (!ctx) {
    throw new Error('useSupabaseSession must be used within a SupabaseSessionProvider');
  }
  return ctx;
}
