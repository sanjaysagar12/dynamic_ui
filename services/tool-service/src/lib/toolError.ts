/**
 * A business-rule failure a tool wants to report with its own code and plain-language message
 * (e.g. SIMILAR_PARTY_EXISTS). translatePrismaError passes these through unchanged, so helpers
 * shared between tools can throw one from deep inside a transaction and the calling tool still
 * returns a clean { ok: false, error, code } instead of the generic INTERNAL_ERROR.
 */
export class ToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}
