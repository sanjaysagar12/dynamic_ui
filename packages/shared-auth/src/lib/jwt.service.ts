import jwt = require('jsonwebtoken');
import type { AuthTokenPayload, VerifiedAuthToken } from './auth-token-payload.js';
import { InvalidTokenError } from './errors.js';

export interface JwtServiceOptions {
  secret: string;
  issuer?: string;
  expiresIn?: `${number}${'s' | 'm' | 'h' | 'd'}`;
}

export class JwtService {
  private readonly secret: string;
  private readonly issuer?: string;
  private readonly expiresIn: `${number}${'s' | 'm' | 'h' | 'd'}`;

  constructor(options: JwtServiceOptions) {
    this.secret = options.secret;
    this.issuer = options.issuer;
    this.expiresIn = options.expiresIn ?? '1h';
  }

  sign(payload: AuthTokenPayload): string {
    return jwt.sign(payload, this.secret, {
      expiresIn: this.expiresIn,
      issuer: this.issuer,
    });
  }

  verify(token: string): VerifiedAuthToken {
    try {
      const decoded = jwt.verify(token, this.secret, {
        issuer: this.issuer,
      });

      if (typeof decoded === 'string') {
        throw new InvalidTokenError();
      }

      return decoded as VerifiedAuthToken;
    } catch {
      throw new InvalidTokenError();
    }
  }
}
