import type { Request } from 'express';
import { InvalidTokenError } from '@org/shared-auth/server';
import type { ArtifactPathResolver, ResolvedArtifactRequest } from '../resolution/artifact-path-resolver.js';
import type { ManifestRepository } from '../manifest/manifest-repository.js';
import type { AuthenticationProvider } from '../auth/authentication-provider.js';
import type { AuthorizationStrategy } from '../authorization/authorization-strategy.js';
import { ArtifactForbiddenError, AuthenticationRequiredError } from '../core/errors.js';

export interface ArtifactServingResult extends ResolvedArtifactRequest {
  /** The token that authorized this request, present whenever content is actually served. */
  token?: string;
}

export class ArtifactService {
  constructor(
    private readonly pathResolver: ArtifactPathResolver,
    private readonly manifestRepository: ManifestRepository,
    private readonly authenticationProvider: AuthenticationProvider,
    private readonly authorizationStrategy: AuthorizationStrategy,
  ) {}

  async handleRequest(req: Request, requestPath: string): Promise<ArtifactServingResult> {
    const resolved = await this.pathResolver.resolve(requestPath);

    if (resolved.requiresTrailingSlashRedirect) {
      return resolved;
    }

    const manifest = await this.manifestRepository.load(resolved.artifactDir);

    let authContext;
    try {
      authContext = this.authenticationProvider.authenticate(req);
    } catch (err) {
      if (err instanceof InvalidTokenError) {
        throw new AuthenticationRequiredError(err.message);
      }
      throw err;
    }

    if (!authContext) {
      throw new AuthenticationRequiredError();
    }

    if (!this.authorizationStrategy.isAuthorized(authContext, manifest)) {
      throw new ArtifactForbiddenError();
    }

    return { ...resolved, token: authContext.token };
  }
}
