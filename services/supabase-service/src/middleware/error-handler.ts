import type { ErrorRequestHandler } from 'express';

/**
 * Catch-all for anything that reaches `next(err)` without already being
 * turned into a response — i.e. errors the route handlers didn't recognize
 * (SupabaseNotConfiguredError / SupabaseRequestError are handled inline and
 * never reach this). Must be registered last, after every router.
 *
 * Without this, Express's own default error handler took over and returned
 * an opaque `{"error":"{}"}"` (JSON.stringify of a bare Error has no
 * enumerable properties) with nothing printed to the server log — which is
 * exactly what made a real upstream failure (Supabase's Auth API returning
 * "Database error querying schema") look like a bug in this service instead
 * of the actual cause.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  console.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, err);

  const status =
    typeof (err as { status?: unknown })?.status === 'number' ? (err as { status: number }).status : 500;
  const message = err instanceof Error ? err.message : 'Unexpected server error';

  res.status(status).json({ error: message });
};
