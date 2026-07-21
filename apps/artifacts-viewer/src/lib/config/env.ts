/** Server-only: base URL of the Backend Service that issues dev JWTs. Never exposed to the browser. */
export function getBackendServiceUrl(): string {
  return process.env.BACKEND_SERVICE_URL || 'http://localhost:3334';
}

/** Public: base URL of the Artifacts Server, used by the browser to load the iframe directly. */
export function getArtifactsServerUrl(): string {
  return process.env.NEXT_PUBLIC_ARTIFACTS_SERVER_URL || 'http://localhost:3000';
}

/** Server-only: base URL of the Agent Service, which generates and updates artifacts via chat. */
export function getAgentServiceUrl(): string {
  return process.env.AGENT_SERVICE_URL || 'http://localhost:5002';
}
