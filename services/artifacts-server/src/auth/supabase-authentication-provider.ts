import type { Request } from 'express';
import type { AuthenticationProvider } from './authentication-provider.js';
import type { AuthContext } from './auth-context.js';

interface VerifyResponse {
  userId: string;
  email: string | null;
  role: string;
}

/**
 * Authenticates artifact requests by forwarding the caller's bearer token to
 * supabase-service's POST /auth/verify — the JWT itself is never decoded or
 * trusted locally, since supabase-service is the only layer holding the
 * Supabase project's auth configuration. A failed/invalid token and a
 * missing one are treated the same way (null), matching the previous local
 * JwtAuthenticationProvider's behavior.
 */
export class SupabaseAuthenticationProvider implements AuthenticationProvider {
  constructor(private readonly supabaseServiceUrl: string) {}

  async authenticate(req: Request): Promise<AuthContext | null> {
    const token = this.extractToken(req);
    if (!token) {
      return null;
    }

    const response = await fetch(new URL('/auth/verify', this.supabaseServiceUrl), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      return null;
    }

    const verified = (await response.json()) as VerifyResponse;
    return { subject: verified.userId, role: verified.role, token };
  }

  private extractToken(req: Request): string | null {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      return header.slice('Bearer '.length).trim();
    }

    // Iframe top-level navigations can't set headers, so the token also
    // travels as a query param — see html-token-rewriter.ts for how it's
    // propagated onto every sub-resource request within the served HTML.
    const queryToken = req.query['token'];
    if (typeof queryToken === 'string' && queryToken.length > 0) {
      return queryToken;
    }

    return null;
  }
}
