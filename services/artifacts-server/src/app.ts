import express = require('express');
import type { Express } from 'express';
import { JwtService } from '@org/shared-auth/server';
import type { AppConfig } from './config.js';
import { ArtifactPathResolver } from './resolution/artifact-path-resolver.js';
import { ManifestRepository } from './manifest/manifest-repository.js';
import { JwtAuthenticationProvider } from './auth/jwt-authentication-provider.js';
import { RoleAuthorizationStrategy } from './authorization/role-authorization-strategy.js';
import { ArtifactService } from './service/artifact-service.js';
import { ArtifactCatalogService } from './service/artifact-catalog.service.js';
import { createArtifactsRouter } from './http/artifacts.router.js';
import { createArtifactsCatalogRouter } from './http/artifacts-catalog.router.js';

export function createApp(config: AppConfig): Express {
  const app = express();

  const jwtService = new JwtService({ secret: config.jwt.secret, issuer: config.jwt.issuer });
  const pathResolver = new ArtifactPathResolver(config.artifactsRoot);
  const manifestRepository = new ManifestRepository();
  const authenticationProvider = new JwtAuthenticationProvider(jwtService);
  const authorizationStrategy = new RoleAuthorizationStrategy();

  const artifactService = new ArtifactService(
    pathResolver,
    manifestRepository,
    authenticationProvider,
    authorizationStrategy,
  );
  const catalogService = new ArtifactCatalogService(config.artifactsRoot);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use(createArtifactsCatalogRouter(catalogService, authenticationProvider));
  app.use(createArtifactsRouter(artifactService));

  return app;
}
