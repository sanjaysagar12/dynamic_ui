import { getArtifactsServerUrl } from '../config/env';

/** Builds the URL for an artifact page, authenticated via a token query param
 *  since iframe navigations cannot carry an Authorization header. */
export function buildArtifactUrl(artifactPath: string, token: string): string {
  const path = artifactPath.startsWith('/') ? artifactPath : `/${artifactPath}`;
  const url = new URL(path, getArtifactsServerUrl());
  url.searchParams.set('token', token);
  return url.toString();
}
