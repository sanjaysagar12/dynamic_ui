import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import { parseChatRequest, ValidationError } from '../schemas.js';
import { ChatArtifactService } from '../services/chat-service.js';
import { ArtifactGenerationError } from '../services/opencode-runner.js';

export function registerAgentRoutes(fastify: FastifyInstance, config: AppConfig): void {
  fastify.post('/agent/chat-artifact', async (request, reply) => {
    let parsed;
    try {
      parsed = parseChatRequest(request.body);
    } catch (err) {
      if (err instanceof ValidationError) {
        return reply.code(422).send({ detail: err.message });
      }
      throw err;
    }

    try {
      return await new ChatArtifactService(config).chat(parsed);
    } catch (err) {
      if (err instanceof ArtifactGenerationError) {
        return reply.code(502).send({ detail: err.message });
      }
      throw err;
    }
  });
}
