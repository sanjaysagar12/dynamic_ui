/** Server-only: base URL of the Artifacts Server. The browser never talks to it directly —
 *  the iframe `src` points at this app's own `/api/artifact-proxy/*` route instead (see
 *  lib/artifacts/artifact-url.ts and app/api/artifact-proxy/[...path]/route.ts), which fetches
 *  from here server-side. That keeps artifacts-server reachable only from this process, not
 *  from the public internet, in a deployment where only artifacts-viewer is exposed.
 *  Default port is 3400, not 3000 — chosen to avoid colliding with other services/containers
 *  that commonly claim 3000 on a shared host. */
export function getArtifactsServerUrl(): string {
  return process.env.ARTIFACTS_SERVER_URL || 'http://localhost:3400';
}

/** Server-only: base URL of the Artifact Agent Service, which generates and updates artifacts via chat. */
export function getArtifactAgentServiceUrl(): string {
  return process.env.ARTIFACT_AGENT_SERVICE_URL || 'http://localhost:5102';
}

/** Server-only: base URL of the DB Agent Service, which answers database questions via chat, scoped to the caller's tool-service access token. */
export function getDbAgentServiceUrl(): string {
  return process.env.DB_AGENT_SERVICE_URL || 'http://localhost:5103';
}

/** Server-only: base URL of tool-service, the plugin-based tool-call layer over Postgres. */
export function getToolServiceUrl(): string {
  return process.env.TOOL_SERVICE_URL || 'http://localhost:5104';
}
