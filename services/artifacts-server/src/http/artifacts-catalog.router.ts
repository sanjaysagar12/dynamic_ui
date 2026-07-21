import { Router } from 'express';
import { InvalidTokenError } from '@org/shared-auth/server';
import type { AuthenticationProvider } from '../auth/authentication-provider.js';
import type { ArtifactCatalogService } from '../service/artifact-catalog.service.js';

export function createArtifactsCatalogRouter(
  catalogService: ArtifactCatalogService,
  authenticationProvider: AuthenticationProvider,
): Router {
  const router = Router();

  router.get('/api/artifacts', async (req, res) => {
    let authContext;
    try {
      authContext = authenticationProvider.authenticate(req);
    } catch (err) {
      if (err instanceof InvalidTokenError) {
        res.status(401).json({ error: err.message });
        return;
      }
      throw err;
    }

    if (!authContext) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const all = await catalogService.list();
    const visible = all.filter((entry) => entry.roles.includes(authContext.role));

    res.json({ role: authContext.role, artifacts: visible });
  });

  return router;
}
