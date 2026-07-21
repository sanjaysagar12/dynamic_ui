import { Router, type NextFunction, type Response } from 'express';
import type { RecordsService } from './records.service.js';
import { requireSupabaseAuth, getSupabaseAuth } from '../auth/require-supabase-auth.js';
import { SupabaseNotConfiguredError, SupabaseRequestError } from '../core/errors.js';

export function createRecordsController(recordsService: RecordsService): Router {
  const router = Router();
  router.use(requireSupabaseAuth);

  router.get('/:table', async (req, res, next) => {
    try {
      const { accessToken } = getSupabaseAuth(req);
      const filters = Object.fromEntries(
        Object.entries(req.query).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      );
      res.json({ data: await recordsService.list(accessToken, req.params.table, filters) });
    } catch (err) {
      handleError(err, res, next);
    }
  });

  router.post('/:table', async (req, res, next) => {
    try {
      const { accessToken } = getSupabaseAuth(req);
      res.status(201).json(await recordsService.create(accessToken, req.params.table, req.body ?? {}));
    } catch (err) {
      handleError(err, res, next);
    }
  });

  router.patch('/:table/:id', async (req, res, next) => {
    try {
      const { accessToken } = getSupabaseAuth(req);
      res.json(await recordsService.update(accessToken, req.params.table, req.params.id, req.body ?? {}));
    } catch (err) {
      handleError(err, res, next);
    }
  });

  router.delete('/:table/:id', async (req, res, next) => {
    try {
      const { accessToken } = getSupabaseAuth(req);
      await recordsService.remove(accessToken, req.params.table, req.params.id);
      res.status(204).send();
    } catch (err) {
      handleError(err, res, next);
    }
  });

  return router;
}

function handleError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof SupabaseNotConfiguredError) {
    res.status(503).json({ error: err.message });
    return;
  }
  if (err instanceof SupabaseRequestError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  next(err);
}
