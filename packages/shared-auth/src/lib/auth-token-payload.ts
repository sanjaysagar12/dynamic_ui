import type { Role } from './role.js';

export interface AuthTokenPayload {
  sub: string;
  role: Role;
}

export interface VerifiedAuthToken extends AuthTokenPayload {
  iat: number;
  exp: number;
}
