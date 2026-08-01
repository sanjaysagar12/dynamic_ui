import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import { parseCreateSkillRequest, parseUpdateSkillRequest, ValidationError } from '../schemas.js';
import {
  createSkill,
  deleteSkill,
  InvalidSkillNameError,
  listSkills,
  readSkill,
  SkillAlreadyExistsError,
  SkillNotFoundError,
  updateSkill,
} from '../services/skill-service.js';

interface SkillNameParams {
  name: string;
}

export function registerSkillsRoutes(fastify: FastifyInstance, config: AppConfig): void {
  fastify.get('/agent/skills', async () => ({ skills: listSkills(config.artifactsRoot) }));

  fastify.get<{ Params: SkillNameParams }>('/agent/skills/:name', async (request, reply) => {
    try {
      const skill = readSkill(config.artifactsRoot, request.params.name);
      if (!skill) {
        return reply.code(404).send({ detail: `Skill '${request.params.name}' not found` });
      }
      return skill;
    } catch (err) {
      if (err instanceof InvalidSkillNameError) {
        return reply.code(400).send({ detail: err.message });
      }
      throw err;
    }
  });

  fastify.post('/agent/skills', async (request, reply) => {
    let parsed;
    try {
      parsed = parseCreateSkillRequest(request.body);
    } catch (err) {
      if (err instanceof ValidationError) {
        return reply.code(422).send({ detail: err.message });
      }
      throw err;
    }

    try {
      const skill = createSkill(config.artifactsRoot, parsed.name, parsed.description, parsed.content);
      return reply.code(201).send(skill);
    } catch (err) {
      if (err instanceof InvalidSkillNameError) {
        return reply.code(400).send({ detail: err.message });
      }
      if (err instanceof SkillAlreadyExistsError) {
        return reply.code(409).send({ detail: err.message });
      }
      throw err;
    }
  });

  fastify.put<{ Params: SkillNameParams }>('/agent/skills/:name', async (request, reply) => {
    let parsed;
    try {
      parsed = parseUpdateSkillRequest(request.body);
    } catch (err) {
      if (err instanceof ValidationError) {
        return reply.code(422).send({ detail: err.message });
      }
      throw err;
    }

    try {
      return updateSkill(config.artifactsRoot, request.params.name, parsed.description, parsed.content);
    } catch (err) {
      if (err instanceof InvalidSkillNameError) {
        return reply.code(400).send({ detail: err.message });
      }
      if (err instanceof SkillNotFoundError) {
        return reply.code(404).send({ detail: err.message });
      }
      throw err;
    }
  });

  fastify.delete<{ Params: SkillNameParams }>('/agent/skills/:name', async (request, reply) => {
    try {
      deleteSkill(config.artifactsRoot, request.params.name);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof InvalidSkillNameError) {
        return reply.code(400).send({ detail: err.message });
      }
      if (err instanceof SkillNotFoundError) {
        return reply.code(404).send({ detail: err.message });
      }
      throw err;
    }
  });
}
