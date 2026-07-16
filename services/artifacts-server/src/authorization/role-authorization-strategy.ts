import type { AuthorizationStrategy } from './authorization-strategy.js';
import type { AuthContext } from '../auth/auth-context.js';
import type { ArtifactManifest } from '../core/manifest.js';

export class RoleAuthorizationStrategy implements AuthorizationStrategy {
  isAuthorized(context: AuthContext, manifest: ArtifactManifest): boolean {
    return manifest.roles.includes(context.role);
  }
}
