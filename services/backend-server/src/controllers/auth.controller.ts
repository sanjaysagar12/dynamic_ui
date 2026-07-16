import { Router } from 'express';
import { isRole, ROLES } from '@org/shared-auth';
import type { TokenService } from '../services/token.service.js';

export function createAuthController(tokenService: TokenService): Router {
  const router = Router();

  router.get('/dev-token', (req, res) => {
    const role = req.query['role'];

    if (!isRole(role)) {
      res.status(400).json({
        error: `Query parameter "role" must be one of: ${ROLES.join(', ')}`,
      });
      return;
    }

    const token = tokenService.issueDevToken(role);
    res.json({ token, role, tokenType: 'Bearer' });
  });

  return router;
}
