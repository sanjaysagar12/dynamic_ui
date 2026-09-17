'use client';

import { SESSION_COOKIE_NAME } from './session-cookie-name';

/**
 * A plain (non-httpOnly) cookie holding only the opaque tool-service access
 * token — never role/email/userId. It has to be JS-readable anyway, since
 * every client fetch attaches it as an `Authorization: Bearer` header itself
 * (see lib/api/*-client.ts); this just makes that same value survive a
 * refresh and lets proxy.ts gate routes on its presence. It is not a
 * new trust boundary: every BFF route still independently verifies the
 * token against tool-service on every request (see ARCHITECTURE.md §3/§6).
 */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // matches the JWT's own 7-day expiry

export function readSessionCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${SESSION_COOKIE_NAME}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function writeSessionCookie(accessToken: string): void {
  if (typeof document === 'undefined') return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(accessToken)}; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

export function clearSessionCookie(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export { SESSION_COOKIE_NAME };
