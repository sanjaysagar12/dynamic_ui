'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { sessionLogin, sessionRegister, type SessionData, type ToolResult } from '../api/session-client';
import { readSessionCookie, writeSessionCookie, clearSessionCookie } from './session-cookie';

export type Session = SessionData;

export interface SessionContextValue {
  session: Session | null;
  pending: boolean;
  /** True only while rehydrating an existing cookie session on first load. */
  hydrating: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, role?: string) => Promise<void>;
  logout: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

interface WhoamiResult {
  ok: boolean;
  data?: { userId: string; email: string; role: string };
}

async function rehydrateFromCookie(accessToken: string): Promise<Session | null> {
  try {
    const response = await fetch('/api/tools/whoami', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const body: WhoamiResult = await response.json();
    if (!response.ok || !body.ok || !body.data) return null;
    return { accessToken, userId: body.data.userId, email: body.data.email, role: body.data.role };
  } catch {
    return null;
  }
}

/**
 * Holds the parent app's tool-service session. The access token is mirrored
 * into a plain cookie (lib/session/session-cookie.ts) purely so a refresh
 * doesn't bounce the user to /login and so middleware.ts can gate routes on
 * its presence — every real authorization decision still happens server-side
 * on each request, exactly as before.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [pending, setPending] = useState(false);
  const [hydrating, setHydrating] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = readSessionCookie();
    if (!token) {
      setHydrating(false);
      return;
    }
    let cancelled = false;
    rehydrateFromCookie(token).then((restored) => {
      if (cancelled) return;
      if (restored) {
        setSession(restored);
      } else {
        clearSessionCookie();
      }
      setHydrating(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
      writeSessionCookie(result.data.accessToken);
    } catch {
      setError('Request failed');
    } finally {
      setPending(false);
    }
  };

  const value: SessionContextValue = {
    session,
    pending,
    hydrating,
    error,
    login: (email, password) => submit(() => sessionLogin(email, password)),
    register: (email, password, role) => submit(() => sessionRegister(email, password, role)),
    logout: () => {
      setSession(null);
      clearSessionCookie();
    },
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
