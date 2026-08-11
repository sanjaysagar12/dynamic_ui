/**
 * Builds the iframe `src` for an artifact page, authenticated via a token query param since
 * iframe navigations cannot carry an Authorization header.
 *
 * This is deliberately a same-origin, relative URL under this app's own `/api/artifact-proxy/`
 * route (see app/api/artifact-proxy/[...path]/route.ts) rather than a direct link to
 * artifacts-server — the browser never needs to know artifacts-server's address at all, so it
 * can be a private/internal-only service in deployment. The proxy route forwards the request to
 * artifacts-server server-side and streams the response straight back, including the
 * Content-Security-Policy header artifacts-server sets on every HTML response.
 *
 * Always resolves to an explicit `.../index.html`, never a bare directory path ending in `/`.
 * Next.js's own routing strips a trailing slash via a redirect (`trailingSlash: false`, the
 * default) before the proxy route ever runs, which would land the iframe's committed document
 * URL one path segment short of where the artifact's relative asset hrefs (`assets/app.js`,
 * `../_shared/tailwind.min.css`, rewritten by artifacts-server's html-token-rewriter.ts) expect
 * it to be — every such href would resolve one directory too shallow. Requesting the index file
 * by name sidesteps that: there's no trailing slash for Next to strip, and artifacts-server
 * serves it directly with no redirect of its own either (artifact-path-resolver.ts only
 * redirects when a *directory* is requested without a slash).
 */
export function buildArtifactUrl(artifactPath: string, token: string): string {
  let path = artifactPath.startsWith('/') ? artifactPath : `/${artifactPath}`;
  if (!path.endsWith('/')) path += '/';
  path += 'index.html';

  const params = new URLSearchParams({ token });
  return `/api/artifact-proxy${path}?${params.toString()}`;
}
