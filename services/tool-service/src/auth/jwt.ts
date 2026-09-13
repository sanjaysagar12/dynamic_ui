// Namespace import, not default — esModuleInterop is off workspace-wide, and
// jsonwebtoken's CJS export has no `.default` for a default import to read.
import * as jwt from 'jsonwebtoken';

export interface TokenPayload {
  sub: string;
  email: string;
  role: string;
}

const EXPIRES_IN = '7d';

export function signToken(payload: TokenPayload, secret: string): string {
  return jwt.sign(payload, secret, { expiresIn: EXPIRES_IN });
}

export function verifyToken(token: string, secret: string): TokenPayload {
  const decoded = jwt.verify(token, secret);
  if (typeof decoded === 'string') {
    throw new Error('Unexpected string JWT payload');
  }
  const { sub, email, role } = decoded as jwt.JwtPayload;
  if (typeof sub !== 'string' || typeof email !== 'string' || typeof role !== 'string') {
    throw new Error('JWT payload missing sub/email/role');
  }
  return { sub, email, role };
}
