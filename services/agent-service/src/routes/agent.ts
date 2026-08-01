import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import { parseChatRequest, parseGenerateArtifactRequest, ValidationError } from '../schemas.js';
import { ArtifactGeneratorService } from '../services/artifact-generator.js';
import { ChatArtifactService } from '../services/chat-service.js';
import { ArtifactGenerationError, listProviders } from '../services/providers.js';

export function registerAgentRoutes(fastify: FastifyInstance, config: AppConfig): void {
  fastify.get('/agent/providers', async () => listProviders(config));

  fastify.post('/agent/generate-artifact', async (request, reply) => {
    let parsed;
    try {
      parsed = parseGenerateArtifactRequest(request.body);
    } catch (err) {
      if (err instanceof ValidationError) {
        return reply.code(422).send({ detail: err.message });
      }
      throw err;
    }

    try {
      return await new ArtifactGeneratorService(config).generate(parsed);
    } catch (err) {
      if (err instanceof ArtifactGenerationError) {
        return reply.code(502).send({ detail: err.message });
      }
      throw err;
    }
  });

  fastify.post('/agent/chat', async (request, reply) => {
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
