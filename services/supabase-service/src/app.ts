import express = require('express');
import type { Express } from 'express';
import type { AppConfig } from './config.js';
import { SupabaseClientFactory } from './supabase/supabase-client-factory.js';
import { AuthService } from './auth/auth.service.js';
import { createAuthController } from './auth/auth.controller.js';
import { RecordsService } from './data/records.service.js';
import { createRecordsController } from './data/records.controller.js';

export function createApp(config: AppConfig): Express {
  const app = express();
  app.use(express.json());

  const clientFactory = new SupabaseClientFactory(config);
  const authService = new AuthService(clientFactory);
  const recordsService = new RecordsService(clientFactory);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/auth', createAuthController(authService));
  app.use('/data', createRecordsController(recordsService));

  return app;
}
