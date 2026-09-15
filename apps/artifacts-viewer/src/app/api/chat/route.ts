import { NextRequest, NextResponse } from 'next/server';
import { AgentServiceError, chatWithAgent } from '../../../lib/api/artifact-agent-service-client';
import { chatWithDbAgent, DbAgentServiceError } from '../../../lib/api/db-agent-service-client';
import { extractAccessToken } from '../../../lib/http/data-request-auth';
import { routeToAgent } from '../../../lib/unified-chat/agent-router';
import type { UnifiedChatRequestPayload, UnifiedChatResponsePayload } from '../../../lib/unified-chat/types';
import type { ChatRequestPayload } from '../../../lib/chat/types';

export async function POST(req: NextRequest): Promise<NextResponse<UnifiedChatResponsePayload | { error: string }>> {
  const payload = (await req.json()) as UnifiedChatRequestPayload;

  // Get the last user message to determine which agent to use
  const lastUserMessage = [...payload.messages].reverse().find((msg) => msg.role === 'user');
  if (!lastUserMessage) {
    return NextResponse.json({ error: 'No user message found' }, { status: 400 });
  }

  const agent = routeToAgent(lastUserMessage.content);

  try {
    if (agent === 'artifact') {
      // Route to artifact agent
      const artifactPayload: ChatRequestPayload = {
        messages: payload.messages,
        slug: payload.slug || null,
        roles: payload.roles || [],
      };

      const result = await chatWithAgent(artifactPayload);
      const response: UnifiedChatResponsePayload = {
        type: 'artifact',
        ...result,
      };
      return NextResponse.json(response);
    } else {
      // Route to DB agent
      const accessToken = extractAccessToken(req);
      if (!accessToken) {
        return NextResponse.json(
          { error: 'Authorization: Bearer <access token> header is required for database operations' },
          { status: 401 },
        );
      }

      const result = await chatWithDbAgent(payload.messages, accessToken);
      const response: UnifiedChatResponsePayload = {
        type: 'db',
        response: result,
        agentType: 'db',
      };
      return NextResponse.json(response);
    }
  } catch (err) {
    if (err instanceof AgentServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof DbAgentServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof Error && err.name === 'TimeoutError') {
      return NextResponse.json(
        { error: 'The agent took too long to respond — try a simpler request, or ask for the change in smaller steps.' },
        { status: 504 },
      );
    }
    return NextResponse.json({ error: 'Unexpected error contacting agent service' }, { status: 502 });
  }
}
