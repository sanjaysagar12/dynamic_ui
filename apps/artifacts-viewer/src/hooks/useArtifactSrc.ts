'use client';

import { buildArtifactUrl } from '../lib/artifacts/artifact-url';

/**
 * Builds the iframe src for an artifact. Only carries this app's own
 * artifacts-server auth token — never a Supabase session. Data access for
 * artifacts that need it goes through the postMessage bridge (see
 * useArtifactDataBridge), not through anything embedded in the URL.
 */
export function useArtifactSrc(artifactPath: string, token: string | null): string | null {
  if (!token || !artifactPath) {
    return null;
  }
  return buildArtifactUrl(artifactPath, token);
}
