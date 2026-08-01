/** Public: base URL of the Artifacts Server, used by the browser to load the iframe directly. */
export function getArtifactsServerUrl(): string {
  return process.env.NEXT_PUBLIC_ARTIFACTS_SERVER_URL || 'http://localhost:3000';
}

/** Server-only: base URL of the Artifact Agent Service, which generates and updates artifacts via chat. */
export function getArtifactAgentServiceUrl(): string {
  return process.env.ARTIFACT_AGENT_SERVICE_URL || 'http://localhost:5002';
}

/** Server-only: base URL of the DB Agent Service, which answers database questions via chat, RLS-scoped to the caller's Supabase JWT. */
export function getDbAgentServiceUrl(): string {
  return process.env.DB_AGENT_SERVICE_URL || 'http://localhost:5003';
}

/** Server-only: base URL of the Supabase Service, the middle layer between artifacts and Supabase. */
export function getSupabaseServiceUrl(): string {
  return process.env.SUPABASE_SERVICE_URL || 'http://localhost:3335';
}
