import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { ToolRegistry } from '../tools/registry.js';
import type { ToolContext } from '../tools/types.js';
import { verifyToken } from '../auth/jwt.js';

interface ExecuteBody {
  args?: unknown;
  confirmed?: boolean;
}

export function registerToolsRoutes(
  fastify: FastifyInstance,
  registry: ToolRegistry,
  prisma: PrismaClient,
  jwtSecret: string,
): void {
  fastify.get('/tools', async () => ({ tools: registry.catalogForListing() }));

  fastify.post<{ Params: { name: string }; Body: ExecuteBody }>('/tools/:name/execute', async (request, reply) => {
    const tool = registry.get(request.params.name);
    if (!tool) {
      reply.code(404);
      return { ok: false, error: `Unknown tool "${request.params.name}"`, code: 'UNKNOWN_TOOL' };
    }

    let ctx: ToolContext;
    if (tool.requiresAuth === false) {
      // Skip verification entirely — even a garbage/expired Authorization
      // header must not affect a tool that doesn't require auth.
      ctx = { userId: null, email: null, role: null, prisma };
    } else {
      const header = request.headers.authorization;
      if (!header?.startsWith('Bearer ')) {
        reply.code(401);
        return { ok: false, error: 'Authorization: Bearer <token> header is required', code: 'UNAUTHENTICATED' };
      }

      try {
        const payload = verifyToken(header.slice('Bearer '.length).trim(), jwtSecret);
        ctx = { userId: payload.sub, email: payload.email, role: payload.role, prisma };
      } catch {
        reply.code(401);
        return { ok: false, error: 'Invalid or expired token', code: 'UNAUTHENTICATED' };
      }

      if (tool.requiredRoles && tool.requiredRoles.length > 0 && !tool.requiredRoles.includes(ctx.role ?? '')) {
        reply.code(403);
        return { ok: false, error: `Role "${ctx.role}" is not permitted to call this tool`, code: 'FORBIDDEN_ROLE' };
      }
    }

    const parsed = tool.inputSchema.safeParse(request.body?.args);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: parsed.error.message, code: 'INVALID_ARGS' };
    }

    if (tool.mutates && request.body?.confirmed !== true) {
      reply.code(409);
      return {
        ok: false,
        error: 'This action mutates data and requires confirmed: true',
        code: 'CONFIRMATION_REQUIRED',
      };
    }

    const result = await tool.handler(ctx, parsed.data);
    reply.code(200);
    return result;
  });
}
