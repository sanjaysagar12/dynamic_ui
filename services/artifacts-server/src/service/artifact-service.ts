import type { FastifyRequest } from 'fastify';
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

  async handleRequest(req: FastifyRequest, requestPath: string): Promise<ArtifactServingResult> {
    const resolved = await this.pathResolver.resolve(requestPath);

    if (resolved.requiresTrailingSlashRedirect) {
      return resolved;
    }

    const manifest = await this.manifestRepository.load(resolved.artifactDir);

    const authContext = await this.authenticationProvider.authenticate(req);

    if (!authContext) {
      throw new AuthenticationRequiredError();
    }

    if (!this.authorizationStrategy.isAuthorized(authContext, manifest)) {
      throw new ArtifactForbiddenError();
    }

    return { ...resolved, token: authContext.token };
  }
}
