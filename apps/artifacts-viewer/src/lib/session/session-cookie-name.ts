/** Not 'use client' — proxy.ts (edge middleware) imports this too, and a constant pulled from a
 *  'use client' module resolves to an opaque client-reference stub there instead of the real
 *  string, silently breaking `request.cookies.has(...)`. Kept in its own plain module so both
 *  proxy.ts and session-cookie.ts can share one source of truth without crossing that boundary. */
export const SESSION_COOKIE_NAME = 'session_token';
