import type { FastifyInstance } from 'fastify';
import type { AuthenticationProvider } from '../auth/authentication-provider.js';
import type { ArtifactCatalogService } from '../service/artifact-catalog.service.js';
import { ArtifactNotFoundError } from '../core/errors.js';

/** Recovers the slug from a `/api/artifacts/<slug>` request URL — used by both the DELETE and
 *  PATCH routes below, which both hang off the same `/api/artifacts/*` wildcard. */
function slugFromUrl(url: string): string {
  const rawSlug = url.replace(/^\/api\/artifacts\//, '').split('?')[0];
  return rawSlug.split('/').map(decodeURIComponent).join('/');
}

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

  // Deletion is gated on the caller's role being OWNER outright — unlike the roles filter above,
  // which is per-artifact visibility (manifest.json's own roles list), this is a flat "can this
  // caller delete anything at all" check, independent of which roles happen to see this artifact.
  fastify.delete('/api/artifacts/*', async (request, reply) => {
    const authContext = await authenticationProvider.authenticate(request);

    if (!authContext) {
      return reply.code(401).send({ error: 'Authentication required' });
    }
    if (authContext.role !== 'OWNER') {
      return reply.code(403).send({ error: 'Only OWNER can delete artifacts' });
    }

    try {
      await catalogService.remove(slugFromUrl(request.url));
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof ArtifactNotFoundError) {
        return reply.code(404).send({ error: err.message });
      }
      throw err;
    }
  });

  // Renaming shares delete's OWNER-only gate — it's a metadata write to manifest.json, not
  // scoped by that artifact's own visibility roles either.
  fastify.patch('/api/artifacts/*', async (request, reply) => {
    const authContext = await authenticationProvider.authenticate(request);

    if (!authContext) {
      return reply.code(401).send({ error: 'Authentication required' });
    }
    if (authContext.role !== 'OWNER') {
      return reply.code(403).send({ error: 'Only OWNER can rename artifacts' });
    }

    const title = (request.body as { title?: unknown } | undefined)?.title;
    if (typeof title !== 'string' || !title.trim()) {
      return reply.code(422).send({ error: 'title is required' });
    }

    try {
      await catalogService.rename(slugFromUrl(request.url), title.trim());
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof ArtifactNotFoundError) {
        return reply.code(404).send({ error: err.message });
      }
      throw err;
    }
  });
}
