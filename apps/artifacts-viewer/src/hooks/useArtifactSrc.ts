'use client';

import { buildArtifactUrl } from '../lib/artifacts/artifact-url';

/**
 * Builds the iframe src for an artifact, carrying the user's own Supabase
 * access token as a query param (iframe navigations can't set headers). The
 * Artifacts Server verifies this token itself via supabase-service — see
 * SupabaseAuthenticationProvider. The artifact's own data access instead goes
 * through the postMessage bridge (see useArtifactDataBridge), never through
 * anything embedded in the URL.
 */
export function useArtifactSrc(artifactPath: string, token: string | null): string | null {
  if (!token || !artifactPath) {
    return null;
  }
  return buildArtifactUrl(artifactPath, token);
}
