import type { Request } from 'express';
import type { AuthContext } from './auth-context.js';

/**
 * Extension point: additional providers (API keys, session cookies, mTLS, ...)
 * can be implemented against this interface and swapped in without touching
 * the artifact serving pipeline.
 */
export interface AuthenticationProvider {
  /** Returns the caller's identity, or null if no credentials were presented or they failed to verify. */
  authenticate(req: Request): Promise<AuthContext | null>;
}
