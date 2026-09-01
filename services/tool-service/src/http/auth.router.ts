import type { FastifyInstance } from 'fastify';
import { verifyToken } from '../auth/jwt.js';

// Not routed through the tool registry — a plain endpoint so a later phase
// (artifacts-server) has a one-line swap target for its own /auth/verify call.
export function registerAuthVerifyRoute(fastify: FastifyInstance, jwtSecret: string): void {
  fastify.post('/auth/verify', async (request, reply) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      reply.code(401);
      return { error: 'Authorization: Bearer <token> header is required' };
    }

    try {
      const payload = verifyToken(header.slice('Bearer '.length).trim(), jwtSecret);
      return { userId: payload.sub, email: payload.email, role: payload.role };
    } catch {
      reply.code(401);
      return { error: 'Invalid or expired token' };
    }
  });
}
