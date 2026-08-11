import type { AppConfig, Provider } from '../config.js';
import type { ProvidersResponse } from '../schemas.js';

export class ArtifactGenerationError extends Error {}

export function listProviders(config: AppConfig): ProvidersResponse {
  return {
    default: config.defaultProvider as Provider,
    providers: [
      { id: 'claude', label: 'Claude', model: config.anthropicModel },
      { id: 'gemini', label: 'Gemini', model: config.geminiModel },
    ],
  };
}
