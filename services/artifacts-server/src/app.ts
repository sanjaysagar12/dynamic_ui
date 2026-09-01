import Fastify, { type FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import { ArtifactPathResolver } from './resolution/artifact-path-resolver.js';
import { ManifestRepository } from './manifest/manifest-repository.js';
import { ToolServiceAuthenticationProvider } from './auth/tool-service-authentication-provider.js';
import { RoleAuthorizationStrategy } from './authorization/role-authorization-strategy.js';
import { ArtifactService } from './service/artifact-service.js';
import { ArtifactCatalogService } from './service/artifact-catalog.service.js';
import { registerArtifactsRoutes } from './http/artifacts.router.js';
import { registerArtifactsCatalogRoutes } from './http/artifacts-catalog.router.js';

export function createApp(config: AppConfig): FastifyInstance {
  const fastify = Fastify();

  const pathResolver = new ArtifactPathResolver(config.artifactsRoot);
  const manifestRepository = new ManifestRepository();
  const authenticationProvider = new ToolServiceAuthenticationProvider(config.toolServiceUrl);
  const authorizationStrategy = new RoleAuthorizationStrategy();

  const artifactService = new ArtifactService(
    pathResolver,
    manifestRepository,
    authenticationProvider,
    authorizationStrategy,
  );
  const catalogService = new ArtifactCatalogService(config.artifactsRoot);

  fastify.get('/health', async () => ({ status: 'ok' }));

  registerArtifactsCatalogRoutes(fastify, catalogService, authenticationProvider);
  registerArtifactsRoutes(fastify, artifactService);

  return fastify;
}
