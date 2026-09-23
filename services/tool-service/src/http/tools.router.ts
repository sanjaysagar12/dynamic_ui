import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { ToolRegistry } from '../tools/registry.js';
import type { ToolContext } from '../tools/types.js';
import { verifyToken } from '../auth/jwt.js';

interface ExecuteBody {
  args?: unknown;
  confirmed?: boolean;
}

/** Same verification POST /tools/:name/execute uses (verifyToken, below), but GET /tools must
 *  stay reachable with no auth at all — opencode's get_tools.ts calls it at artifact-generation
 *  time with no token by design (see AGENTS.md) — so a missing header or a garbage/expired token
 *  both just fall through to `null` (unfiltered) instead of 401ing the request. */
function resolveListingRole(header: string | undefined, jwtSecret: string): string | null {
  if (!header?.startsWith('Bearer ')) {
    return null;
  }
  try {
    return verifyToken(header.slice('Bearer '.length).trim(), jwtSecret).role;
  } catch {
    return null;
  }
}

export function registerToolsRoutes(
  fastify: FastifyInstance,
  registry: ToolRegistry,
  prisma: PrismaClient,
  jwtSecret: string,
): void {
  fastify.get('/tools', async (request) => ({ tools: registry.catalogForListing(resolveListingRole(request.headers.authorization, jwtSecret)) }));

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
