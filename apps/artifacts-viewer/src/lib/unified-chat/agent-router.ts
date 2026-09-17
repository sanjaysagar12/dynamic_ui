import type { AgentType } from './types';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// A classification call this cheap doesn't need a frontier model — Haiku is
// far less costly per turn and plenty accurate for a two-way "artifact vs
// db" decision. Configurable (not hardcoded) so this can be tuned without a
// code change/redeploy; see docker-compose.yml and .env.example.
const ROUTER_MODEL = process.env.AGENT_ROUTER_MODEL || 'claude-haiku-4-5-20251001';

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
      model: ROUTER_MODEL,
      max_tokens: 50,
      system: `You are a routing classifier for an ERP application's chat assistant. Decide which backend should handle the user's message:

- "artifact" — ONLY when the user is clearly asking to build, generate, or make a visible change to a page/UI (e.g. "build a sales dashboard", "create a landing page", "add a chart to this page", "make the header bigger"). This is a deliberate, explicit request to create or edit a page.
- "db" — everything else: greetings, small talk, questions about the assistant, and querying/inserting/updating/deleting data. This is the default — if the message isn't a clear, explicit request to build or visually change a page, respond "db".

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
