import express = require('express');
import type { Express } from 'express';
import type { AppConfig } from './config.js';
import { TokenService } from './services/token.service.js';
import { createAuthController } from './controllers/auth.controller.js';

export function createApp(config: AppConfig): Express {
  const app = express();
  const tokenService = new TokenService(config);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/auth', createAuthController(tokenService));

  return app;
}
