export class ValidationError extends Error {}

/** The caller's tool-service JWT was missing, invalid, or expired — a real auth failure, aborts the whole turn. */
export class ToolServiceAuthError extends Error {}

/** tool-service rejected the call itself (unknown tool, invalid args, forbidden role, unconfirmed
 *  mutation, or an upstream failure) — distinct from a call that reached the tool's handler and
 *  came back `{ ok: false }` as a legitimate result, which is not an error at all. */
export class ToolServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** The Anthropic API call itself failed (network, auth, rate limit, etc.). */
export class DbAgentGenerationError extends Error {}
