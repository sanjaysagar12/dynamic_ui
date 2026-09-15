import type { AgentType } from './types';

const ARTIFACT_KEYWORDS = [
  'create',
  'generate',
  'design',
  'build',
  'make',
  'write',
  'render',
  'artifact',
  'ui',
  'interface',
  'component',
  'page',
  'html',
  'react',
  'visual',
  'layout',
  'chart',
  'graph',
  'dashboard',
];

const DB_KEYWORDS = [
  'query',
  'select',
  'show',
  'list',
  'count',
  'insert',
  'update',
  'delete',
  'manipulate',
  'database',
  'table',
  'data',
  'fetch',
  'retrieve',
  'modify',
  'store',
  'save',
  'remove',
  'add',
  'change',
  'edit',
];

/**
 * Routes a user message to either the artifact agent or database agent
 * based on keyword analysis and intent detection.
 *
 * @param message - The user's message
 * @returns 'artifact' for artifact generation, 'db' for database operations
 */
export function routeToAgent(message: string): AgentType {
  const lowerMessage = message.toLowerCase();

  // Count occurrences of keywords
  let artifactScore = 0;
  let dbScore = 0;

  ARTIFACT_KEYWORDS.forEach((keyword) => {
    if (lowerMessage.includes(keyword)) {
      artifactScore++;
    }
  });

  DB_KEYWORDS.forEach((keyword) => {
    if (lowerMessage.includes(keyword)) {
      dbScore++;
    }
  });

  // If scores are equal or both are 0, default to DB (data operations are more common)
  if (dbScore >= artifactScore) {
    return 'db';
  }

  return 'artifact';
}
