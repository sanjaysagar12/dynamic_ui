'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { sessionLogin, sessionRegister, type SessionData, type ToolResult } from '../api/session-client';

export type Session = SessionData;

export interface SessionContextValue {
  session: Session | null;
  pending: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, role?: string) => Promise<void>;
  logout: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * Holds the parent app's tool-service session (obtained once, here) so it can
 * be handed to *any* artifact's iframe uniformly — artifacts don't each
 * manage their own login; they just receive a token if one is available.
 * Held in React state only — never localStorage or cookies.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (call: () => Promise<ToolResult<SessionData>>) => {
    setPending(true);
    setError(null);

    try {
      const result = await call();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSession(result.data);
    } catch {
      setError('Request failed');
    } finally {
      setPending(false);
    }
  };

  const value: SessionContextValue = {
    session,
    pending,
    error,
    login: (email, password) => submit(() => sessionLogin(email, password)),
    register: (email, password, role) => submit(() => sessionRegister(email, password, role)),
    logout: () => setSession(null),
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return ctx;
}
