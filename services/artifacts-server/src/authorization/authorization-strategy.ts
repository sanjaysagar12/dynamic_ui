import type { AuthContext } from '../auth/auth-context.js';
import type { ArtifactManifest } from '../core/manifest.js';

/**
 * Extension point: alternate strategies (e.g. attribute-based access control)
 * can implement this interface and be swapped in without touching callers.
 */
export interface AuthorizationStrategy {
  isAuthorized(context: AuthContext, manifest: ArtifactManifest): boolean;
}
