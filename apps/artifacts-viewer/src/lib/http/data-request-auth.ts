import type { NextRequest } from 'next/server';

export interface DataAuthHeaders {
  accessToken: string;
  userId?: string;
}

/** Reads the Supabase access token (required) and user id (optional) an artifact attaches to its own requests. */
export function extractDataAuth(req: NextRequest): DataAuthHeaders | null {
  const header = req.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) {
    return null;
  }

  const userId = req.headers.get('x-user-id');
  return { accessToken: header.slice('Bearer '.length).trim(), userId: userId || undefined };
}
