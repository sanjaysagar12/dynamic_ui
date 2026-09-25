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
 * Routes a user message to either the artifact agent (builds/edits screens) or the database
 * agent (answers questions and makes changes to stock, jobs, POs, counts).
 *
 * @param message - The user's message (already translated to English)
 * @param lastRoute - Which agent handled the previous turn in this conversation, if any.
 *   Optional so existing callers keep working, but pass it: short follow-ups ("yes", "100",
 *   "make it bigger") can't be routed correctly without knowing what they're following up.
 * @returns 'artifact' for screen building, 'db' for everything else
 */
export async function routeToAgent(message: string, lastRoute?: AgentType): Promise<AgentType> {
  const context = lastRoute
    ? `The previous message in this conversation was handled by: ${lastRoute}.`
    : 'This is the first message in the conversation.';

  try {
    const response = await client.messages.create({
      model: ROUTER_MODEL,
      max_tokens: 10,
      system: `You route messages in the chat of a stores/inventory system for a transformer factory. Two agents exist:

"artifact" — builds or changes a SCREEN: a page, dashboard, report layout, form layout, chart, button, colour, column, or anything about how a screen looks or is arranged.
  Examples: "build a screen to issue material", "make a dashboard of stock value and pending approvals", "add a current-stock column to the issue screen", "show the leak report as a bar chart", "make the approve button green", "put the total at the top".

"db" — everything about the business data itself: asking about stock, jobs, BOMs, purchase orders, receipts, issues, returns, scrap, counts, approvals, reports, costs, rates; making any change to that data; greetings; questions about what the system can do.
  Examples: "how much wire do we have", "issue for job 31", "raise a PO for the core shortfall", "approve the count", "show me the leak report", "what did job 31 cost", "which materials are below minimum", "hi".

Watch out:
- "show me X" / "what is X" / "list X" is "db" — the user wants the answer, not a new screen. It is "artifact" only if they ask to BUILD, MAKE, CREATE, DESIGN or CHANGE a screen, page, dashboard or chart.
- Adding, creating or updating a business RECORD — a material, party, job, purchase order, count, customer — is "db", even when the message lists several attributes of it (name, unit, quantity, rate, colour of the item itself). That detail is data going INTO the record, not a description of a screen. Only classify as "artifact" when what's being added/changed is part of the SCREEN itself (a column, a button, a chart, a field's position, a page).
  Examples: "add a material called 22 SWG Copper Wire, unit KG, minimum level 50" is "db" (a data record). "add a minimum-level column to the materials screen" is "artifact" (a screen change).
- The word "artifact" appearing in the message is not itself evidence either way — judge the actual request. "create an artifact to show the leak report" is "artifact" (explicitly asks to build a screen). "I need to create a material, I don't need an artifact for it" is "db" (explicitly declines a screen).
- Short follow-ups — "yes", "no", "ok", "100", "the second one", "change it to 50", "go ahead" — belong to whichever agent handled the previous message. Follow the context line below.
- A request to change how something LOOKS is "artifact" even if short ("bigger", "move it left") when the previous message was "artifact".
- If unsure, answer "db".

${context}

Reply with exactly one word: artifact or db.`,
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
