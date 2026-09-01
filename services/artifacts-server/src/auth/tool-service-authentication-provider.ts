import type { FastifyRequest } from 'fastify';
import type { AuthenticationProvider } from './authentication-provider.js';
import type { AuthContext } from './auth-context.js';

interface VerifyResponse {
  userId: string;
  email: string | null;
  role: string;
}

/**
 * Authenticates artifact requests by forwarding the caller's bearer token to
 * tool-service's POST /auth/verify — the JWT itself is never decoded or
 * trusted locally, since tool-service is the only layer holding the
 * JWT_SECRET it was signed with. A failed/invalid token and a missing one
 * are treated the same way (null), matching the previous local
 * JwtAuthenticationProvider's behavior.
 */
export class ToolServiceAuthenticationProvider implements AuthenticationProvider {
  constructor(private readonly toolServiceUrl: string) {}

  async authenticate(req: FastifyRequest): Promise<AuthContext | null> {
    const token = this.extractToken(req);
    if (!token) {
      return null;
    }

    const response = await fetch(new URL('/auth/verify', this.toolServiceUrl), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      return null;
    }

    const verified = (await response.json()) as VerifyResponse;
    return { subject: verified.userId, role: verified.role, token };
  }

  private extractToken(req: FastifyRequest): string | null {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      return header.slice('Bearer '.length).trim();
    }

    // Iframe top-level navigations can't set headers, so the token also
    // travels as a query param — see html-token-rewriter.ts for how it's
    // propagated onto every sub-resource request within the served HTML.
    const queryToken = (req.query as Record<string, unknown>)['token'];
    if (typeof queryToken === 'string' && queryToken.length > 0) {
      return queryToken;
    }

    return null;
  }
}
