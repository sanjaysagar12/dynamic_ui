import { Router, type NextFunction, type Response } from 'express';
import type { AuthService } from './auth.service.js';
import { SupabaseNotConfiguredError, SupabaseRequestError } from '../core/errors.js';

export function createAuthController(authService: AuthService): Router {
  const router = Router();

  router.post('/signup', async (req, res, next) => {
    try {
      const { email, password } = req.body ?? {};
      if (typeof email !== 'string' || typeof password !== 'string') {
        res.status(400).json({ error: 'email and password are required' });
        return;
      }
      res.json(await authService.signUp(email, password));
    } catch (err) {
      handleAuthError(err, res, next);
    }
  });

  router.post('/login', async (req, res, next) => {
    try {
      const { email, password } = req.body ?? {};
      if (typeof email !== 'string' || typeof password !== 'string') {
        res.status(400).json({ error: 'email and password are required' });
        return;
      }
      res.json(await authService.signIn(email, password));
    } catch (err) {
      handleAuthError(err, res, next);
    }
  });

  return router;
}

function handleAuthError(err: unknown, res: Response, next: NextFunction): void {
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
