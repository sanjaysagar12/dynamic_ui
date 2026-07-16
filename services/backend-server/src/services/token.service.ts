import { randomUUID } from 'crypto';
import type { Role } from '@org/shared-auth';
import { JwtService } from '@org/shared-auth/server';
import type { AppConfig } from '../config.js';

export class TokenService {
  private readonly jwtService: JwtService;

  constructor(config: AppConfig) {
    this.jwtService = new JwtService({
      secret: config.jwt.secret,
      issuer: config.jwt.issuer,
      expiresIn: config.jwt.expiresIn,
    });
  }

  issueDevToken(role: Role): string {
    return this.jwtService.sign({ sub: randomUUID(), role });
  }
}
