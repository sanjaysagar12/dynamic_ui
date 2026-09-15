import type { AgentType } from './types';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Routes a user message to either the artifact agent or database agent
 * based on LLM analysis of user intent.
 *
 * @param message - The user's message
 * @returns 'artifact' for artifact generation, 'db' for database operations
 */
export async function routeToAgent(message: string): Promise<AgentType> {
  try {
    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 50,
      system: `You are an expert at analyzing user intentions. Given a user message, determine if they want to:
1. Create, generate, or design visual content (artifacts, UI components, dashboards, charts, forms, HTML, React components, layouts, visualizations) → respond "artifact"
2. Query, insert, update, delete, or manipulate data from a database (fetch data, select records, modify entries, manage databases) → respond "db"

Respond with ONLY the word "artifact" or "db", nothing else.`,
      messages: [
        {
          role: 'user',
          content: message,
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      return 'db';
    }

    const decision = content.text.toLowerCase().trim();
    if (decision.includes('artifact')) {
      return 'artifact';
    }

    return 'db';
  } catch (error) {
    console.error('Error routing with LLM:', error);
    return 'db';
  }
}
