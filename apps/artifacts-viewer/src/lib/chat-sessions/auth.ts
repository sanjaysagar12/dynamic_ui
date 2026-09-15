import 'server-only';
import { executeTool } from '../api/tool-service-client';

/**
 * Resolves the caller's own tool-service identity from their access token.
 *
 * This app never decodes/verifies the JWT itself — `JWT_SECRET` is held
 * only by tool-service (see services/tool-service/src/auth/jwt.ts), and
 * every other service asks it to verify a token instead. `whoami` is an
 * existing authenticated tool-service tool that does exactly that; reusing
 * it here (rather than adding a bespoke verification endpoint) keeps this
 * app consistent with how it already authenticates every other
 * token-bearing request (see lib/api/tool-service-client.ts's `executeTool`).
 */
export async function resolveUserId(accessToken: string): Promise<string | null> {
  const { status, body } = await executeTool('whoami', {}, undefined, accessToken);
  if (status !== 200 || !body.ok) {
    return null;
  }
  const data = body.data as { userId?: unknown };
  return typeof data.userId === 'string' ? data.userId : null;
}
