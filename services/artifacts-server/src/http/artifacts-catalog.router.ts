import type { FastifyInstance } from 'fastify';
import type { AuthenticationProvider } from '../auth/authentication-provider.js';
import type { ArtifactCatalogService } from '../service/artifact-catalog.service.js';

export function registerArtifactsCatalogRoutes(
  fastify: FastifyInstance,
  catalogService: ArtifactCatalogService,
  authenticationProvider: AuthenticationProvider,
): void {
  fastify.get('/api/artifacts', async (request, reply) => {
    const authContext = await authenticationProvider.authenticate(request);

    if (!authContext) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    const all = await catalogService.list();
    const visible = all.filter((entry) => entry.roles.includes(authContext.role));

    return { role: authContext.role, artifacts: visible };
  });
}
