import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppConfig } from '../config.js';
import { DbAgentGenerationError, ToolServiceAuthError, ToolServiceError } from '../core/errors.js';
import { parseChatDbRequest, parseSubmitFormRequest, ValidationError } from '../schemas.js';
import { DbChatService } from '../services/db-chat-service.js';
import type { ToolServiceClient } from '../services/tool-service-client.js';

export function registerAgentRoutes(fastify: FastifyInstance, config: AppConfig, toolService: ToolServiceClient): void {
  fastify.post('/agent/chat-db', async (request, reply) => {
    let parsed;
    try {
      parsed = parseChatDbRequest(request.body);
    } catch (err) {
      if (err instanceof ValidationError) {
        return reply.code(422).send({ detail: err.message });
      }
      throw err;
    }

    try {
      // toolService is shared across requests (constructed once in app.ts) so its tool-catalog
      // cache actually persists between turns; DbChatService itself stays cheap and per-request.
      return await new DbChatService(config, toolService).chat(parsed);
    } catch (err) {
      return handleChatError(err, reply);
    }
  });

  fastify.post('/agent/submit-form', async (request, reply) => {
    let parsed;
    try {
      parsed = parseSubmitFormRequest(request.body);
    } catch (err) {
      if (err instanceof ValidationError) {
        return reply.code(422).send({ detail: err.message });
      }
      throw err;
    }

    try {
      return await new DbChatService(config, toolService).submitForm(parsed);
    } catch (err) {
      return handleChatError(err, reply);
    }
  });
}

function handleChatError(err: unknown, reply: FastifyReply) {
  if (err instanceof ToolServiceAuthError) {
    // A real auth failure (missing/invalid/expired tool-service session) — distinct from a
    // tool result that legitimately came back empty or `{ ok: false }`, which never reaches
    // this branch at all.
    return reply.code(401).send({ detail: err.message });
  }
  if (err instanceof ToolServiceError) {
    // Escapes chat()/submitForm() only from the tool-catalog fetch itself (GET /tools
    // unreachable/failing) — every per-tool-call ToolServiceError is already caught inside
    // DbChatService.
    return reply.code(502).send({ detail: err.message });
  }
  if (err instanceof DbAgentGenerationError) {
    return reply.code(502).send({ detail: err.message });
  }
  throw err;
}
