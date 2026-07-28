import { Router } from 'express';
import type { AuthenticationProvider } from '../auth/authentication-provider.js';
import type { ArtifactCatalogService } from '../service/artifact-catalog.service.js';

export function createArtifactsCatalogRouter(
  catalogService: ArtifactCatalogService,
  authenticationProvider: AuthenticationProvider,
): Router {
  const router = Router();

  router.get('/api/artifacts', async (req, res) => {
    const authContext = await authenticationProvider.authenticate(req);

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
