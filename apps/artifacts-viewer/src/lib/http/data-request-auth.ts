import type { NextRequest } from 'next/server';

/** Reads the session's Bearer access token a browser-side call attaches to its own BFF request. */
export function extractAccessToken(req: NextRequest): string | null {
  const header = req.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) {
    return null;
  }
  return header.slice('Bearer '.length).trim();
}
