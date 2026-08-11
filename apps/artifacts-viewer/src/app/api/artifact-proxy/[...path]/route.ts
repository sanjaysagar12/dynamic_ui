import { NextRequest } from 'next/server';
import { getArtifactsServerUrl } from '../../../../lib/config/env';

const PROXY_PREFIX = '/api/artifact-proxy';

// Headers from artifacts-server's response that actually matter to the browser. Deliberately an
// allowlist, not a blind copy of every upstream header — Content-Security-Policy in particular
// is a real security control (it's what stops artifact JS from making outbound network calls;
// see artifacts.router.ts) and MUST reach the browser exactly as artifacts-server set it.
const FORWARDED_RESPONSE_HEADERS = ['content-type', 'content-security-policy'];

/**
 * Proxies GET requests for artifact content (HTML pages and their CSS/JS/asset sub-resources)
 * through to artifacts-server, so the browser only ever talks to this app's own origin — it
 * never needs to know artifacts-server's address, which lets artifacts-server be a
 * private/internal-only service in deployment (only artifacts-viewer needs to be publicly
 * reachable).
 *
 * The iframe `src` (see lib/artifacts/artifact-url.ts) and every relative href/src rewritten
 * into an artifact's HTML by artifacts-server's own html-token-rewriter.ts both point back at
 * this same route, so nested asset requests (assets/app.js, ../_shared/tailwind.min.css, …) are
 * proxied the same way as the top-level page load — this route's path structure mirrors
 * artifacts-server's own 1:1, just with this prefix in front.
 *
 * A directory request without a trailing slash gets a 301 back from artifacts-server
 * (artifact-path-resolver.ts); that's followed transparently by fetch()'s own default
 * `redirect: "follow"` behavior as a server-to-server hop the browser never sees, rather than
 * this route re-implementing that redirect logic itself.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  await params; // path segments aren't used directly — see note on req.nextUrl.pathname below.

  // Read the artifact path straight off the request URL rather than the resolved `path` param
  // array, so a trailing slash on the incoming request (which matters to artifacts-server — it's
  // exactly what distinguishes "serve index.html" from "redirect to add the slash") is preserved
  // exactly as the browser sent it, instead of being normalized away by route-param parsing.
  const artifactPath = req.nextUrl.pathname.slice(PROXY_PREFIX.length) || '/';

  const target = new URL(artifactPath, getArtifactsServerUrl());
  target.search = req.nextUrl.search;

  let upstream: Response;
  try {
    upstream = await fetch(target, { cache: 'no-store' });
  } catch (err) {
    console.error(`artifact-proxy: failed to reach artifacts-server for ${artifactPath}:`, err);
    return Response.json({ error: 'Unexpected error contacting the artifacts server' }, { status: 502 });
  }

  const headers = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }

  // Streamed straight through rather than buffered/re-encoded — artifact content can be binary
  // (fonts, images) as well as text, and this way large assets don't sit fully in memory here.
  return new Response(upstream.body, { status: upstream.status, headers });
}
