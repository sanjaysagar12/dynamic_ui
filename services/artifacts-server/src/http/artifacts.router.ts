import { readFile } from 'fs/promises';
import { extname } from 'path';
import { Router } from 'express';
import type { ArtifactService } from '../service/artifact-service.js';
import { ArtifactForbiddenError, ArtifactNotFoundError, AuthenticationRequiredError } from '../core/errors.js';
import { rewriteRelativeUrlsWithToken } from './html-token-rewriter.js';

const HTML_EXTENSIONS = new Set(['.html', '.htm']);

export function createArtifactsRouter(artifactService: ArtifactService): Router {
  const router = Router();

  router.get(/.*/, async (req, res) => {
    try {
      const result = await artifactService.handleRequest(req, req.path);

      if (result.requiresTrailingSlashRedirect) {
        const target = `${req.originalUrl.split('?')[0]}/${req.originalUrl.includes('?') ? `?${req.originalUrl.split('?')[1]}` : ''}`;
        res.redirect(301, target);
        return;
      }

      if (result.token && HTML_EXTENSIONS.has(extname(result.filePath).toLowerCase())) {
        const html = await readFile(result.filePath, 'utf-8');
        res.type('html').send(rewriteRelativeUrlsWithToken(html, result.token));
        return;
      }

      res.sendFile(result.filePath);
    } catch (err) {
      if (err instanceof AuthenticationRequiredError) {
        res.status(401).json({ error: err.message });
        return;
      }
      if (err instanceof ArtifactForbiddenError) {
        res.status(403).json({ error: err.message });
        return;
      }
      if (err instanceof ArtifactNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  return router;
}
