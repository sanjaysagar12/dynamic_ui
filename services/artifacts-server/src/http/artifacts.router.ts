import { readFile } from 'fs/promises';
import { extname } from 'path';
import type { FastifyInstance } from 'fastify';
import { lookup } from 'mime-types';
import type { ArtifactService } from '../service/artifact-service.js';
import { ArtifactForbiddenError, ArtifactNotFoundError, AuthenticationRequiredError } from '../core/errors.js';
import { rewriteRelativeUrlsWithToken } from './html-token-rewriter.js';

const HTML_EXTENSIONS = new Set(['.html', '.htm']);

export function registerArtifactsRoutes(fastify: FastifyInstance, artifactService: ArtifactService): void {
  fastify.get('/*', async (request, reply) => {
    const [pathname, query] = request.url.split('?');

    try {
      const result = await artifactService.handleRequest(request, pathname);

      if (result.requiresTrailingSlashRedirect) {
        const target = `${pathname}/${query ? `?${query}` : ''}`;
        return reply.redirect(target, 301);
      }

      if (result.token && HTML_EXTENSIONS.has(extname(result.filePath).toLowerCase())) {
        const html = await readFile(result.filePath, 'utf-8');
        // Artifacts must never make outbound network calls of their own — all
        // persisted-data access goes through the parent's postMessage bridge.
        // The iframe sandbox attribute doesn't restrict fetch/XHR/WebSocket by
        // itself, so this CSP is what actually closes that gap.
        reply.header('Content-Security-Policy', "connect-src 'none'");
        return reply.type('text/html').send(rewriteRelativeUrlsWithToken(html, result.token));
      }

      const contents = await readFile(result.filePath);
      const contentType = lookup(result.filePath) || 'application/octet-stream';
      return reply.type(contentType).send(contents);
    } catch (err) {
      if (err instanceof AuthenticationRequiredError) {
        return reply.code(401).send({ error: err.message });
      }
      if (err instanceof ArtifactForbiddenError) {
        return reply.code(403).send({ error: err.message });
      }
      if (err instanceof ArtifactNotFoundError) {
        return reply.code(404).send({ error: err.message });
      }
      throw err;
    }
  });
}
