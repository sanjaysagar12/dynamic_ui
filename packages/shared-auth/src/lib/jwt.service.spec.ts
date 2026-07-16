import { JwtService } from './jwt.service.js';
import { InvalidTokenError } from './errors.js';

describe('JwtService', () => {
  const service = new JwtService({ secret: 'test-secret', issuer: 'test-issuer' });

  it('round-trips a signed token', () => {
    const token = service.sign({ sub: 'user-1', role: 'admin' });
    const decoded = service.verify(token);

    expect(decoded.sub).toBe('user-1');
    expect(decoded.role).toBe('admin');
  });

  it('rejects tokens signed with a different secret', () => {
    const otherService = new JwtService({ secret: 'other-secret', issuer: 'test-issuer' });
    const token = otherService.sign({ sub: 'user-1', role: 'admin' });

    expect(() => service.verify(token)).toThrow(InvalidTokenError);
  });

  it('rejects garbage tokens', () => {
    expect(() => service.verify('not-a-jwt')).toThrow(InvalidTokenError);
  });
});
