/** Public: base URL of the Artifacts Server, used by the browser to load the iframe directly.
 *  Default port is 3400, not 3000 — chosen to avoid colliding with other services/containers
 *  that commonly claim 3000 on a shared host. */
export function getArtifactsServerUrl(): string {
  return process.env.NEXT_PUBLIC_ARTIFACTS_SERVER_URL || 'http://localhost:3400';
}

/** Server-only: base URL of the Artifact Agent Service, which generates and updates artifacts via chat. */
export function getArtifactAgentServiceUrl(): string {
  return process.env.ARTIFACT_AGENT_SERVICE_URL || 'http://localhost:5102';
}

/** Server-only: base URL of the DB Agent Service, which answers database questions via chat, RLS-scoped to the caller's Supabase JWT. */
export function getDbAgentServiceUrl(): string {
  return process.env.DB_AGENT_SERVICE_URL || 'http://localhost:5103';
}

/** Server-only: base URL of the Supabase Service, the middle layer between artifacts and Supabase. */
export function getSupabaseServiceUrl(): string {
  return process.env.SUPABASE_SERVICE_URL || 'http://localhost:3335';
}
