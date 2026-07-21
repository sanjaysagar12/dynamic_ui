import type { Request } from 'express';
import { JwtService } from '@org/shared-auth/server';
import type { AuthenticationProvider } from './authentication-provider.js';
import type { AuthContext } from './auth-context.js';

export class JwtAuthenticationProvider implements AuthenticationProvider {
  constructor(private readonly jwtService: JwtService) {}

  authenticate(req: Request): AuthContext | null {
    const token = this.extractToken(req);
    if (!token) {
      return null;
    }

    const payload = this.jwtService.verify(token);
    return { subject: payload.sub, role: payload.role, token };
  }

  private extractToken(req: Request): string | null {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      return header.slice('Bearer '.length).trim();
    }

    const queryToken = req.query['token'];
    if (typeof queryToken === 'string' && queryToken.length > 0) {
      return queryToken;
    }

    return null;
  }
}
