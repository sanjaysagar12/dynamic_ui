import type { Request, Response, NextFunction } from 'express';

export interface SupabaseAuthContext {
  accessToken: string;
  userId?: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    supabaseAuth?: SupabaseAuthContext;
  }
}

/**
 * Extracts the Supabase access token (Authorization header). Row-level
 * security derives the caller's identity from this token alone, so it's the
 * only thing that's actually required; X-User-Id is optional passthrough
 * metadata some callers use for their own filtering.
 */
export function requireSupabaseAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization: Bearer <supabase access token> header is required' });
    return;
  }

  const userId = req.headers['x-user-id'];
  req.supabaseAuth = {
    accessToken: header.slice('Bearer '.length).trim(),
    userId: typeof userId === 'string' && userId.length > 0 ? userId : undefined,
  };
  next();
}

/** Reads the context attached by requireSupabaseAuth. Only call this on routes behind that middleware. */
export function getSupabaseAuth(req: Request): SupabaseAuthContext {
  if (!req.supabaseAuth) {
    throw new Error('getSupabaseAuth() called on a route without requireSupabaseAuth');
  }
  return req.supabaseAuth;
}
