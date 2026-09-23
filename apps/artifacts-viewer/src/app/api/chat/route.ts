import { NextRequest, NextResponse } from 'next/server';
import { ROLES } from '@org/shared-types';
import { AgentServiceError, chatWithAgent } from '../../../lib/api/artifact-agent-service-client';
import { chatWithDbAgent, DbAgentServiceError } from '../../../lib/api/db-agent-service-client';
import { translateToEnglish } from '../../../lib/api/gemini-client';
import { extractAccessToken } from '../../../lib/http/data-request-auth';
import { routeToAgent } from '../../../lib/unified-chat/agent-router';
import { resolveUserId } from '../../../lib/chat-sessions/auth';
import {
  appendMessage,
  createSession,
  getCurrentArtifactSlug,
  getMessageHistory,
  getSessionById,
  getLastRoute,
} from '../../../lib/chat-sessions/store';
import type { ChatTurnRequestPayload, ChatTurnResponsePayload } from '../../../lib/chat-sessions/types';
import type { ChatRequestPayload } from '../../../lib/chat/types';

export async function POST(req: NextRequest): Promise<NextResponse<ChatTurnResponsePayload | { error: string }>> {
  const payload = (await req.json().catch(() => null)) as ChatTurnRequestPayload | null;
  if (!payload || typeof payload.message !== 'string' || !payload.message.trim()) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }

  // Chat sessions belong to a user (ChatSession.userId is not nullable — see
  // prisma/schema.prisma), so — unlike the previous stateless endpoint — every turn now needs a
  // verified caller, not just database-routed ones.
  const accessToken = extractAccessToken(req);
  if (!accessToken) {
    return NextResponse.json({ error: 'Authorization: Bearer <access token> header is required' }, { status: 401 });
  }
  const userId = await resolveUserId(accessToken);
  if (!userId) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
  }

  let session;
  if (payload.sessionId) {
    session = await getSessionById(payload.sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    if (session.userId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  } else {
    session = await createSession(userId, payload.message);
  }

  const priorHistory = await getMessageHistory(session.id);
  // Persisted before either backend agent is called — a request that fails partway through
  // (network error, agent timeout, …) still leaves the user's own message recorded. Always the
  // original text, regardless of language — translation below is transient, used only for
  // routing/the agent call, never stored.
  await appendMessage(session.id, 'user', payload.message);

  // Translate to English before routing/calling an agent, so both see consistent English input
  // regardless of what language the user typed or spoke in. Best-effort: a translation failure
  // shouldn't fail the whole turn, just fall back to routing the original text as-is.
  let translatedMessage = payload.message;
  try {
    translatedMessage = await translateToEnglish(payload.message);
  } catch (err) {
    console.error('Translation failed, falling back to original text:', err);
  }

  const history = [...priorHistory, { role: 'user' as const, content: translatedMessage }];

  const route = await routeToAgent(translatedMessage, await getLastRoute(session.id));

  try {
    if (route === 'artifact') {
      const currentSlug = await getCurrentArtifactSlug(session.id);
      const artifactPayload: ChatRequestPayload = {
        messages: history,
        slug: currentSlug,
        roles: ROLES.slice(),
      };
      const result = await chatWithAgent(artifactPayload);

      await appendMessage(session.id, 'assistant', result.reply, { route: 'artifact', artifactSlug: result.slug });

      const response: ChatTurnResponsePayload = {
        sessionId: session.id,
        reply: result.reply,
        route: 'artifact',
        artifactSlug: result.slug,
        artifact: { slug: result.slug, title: result.title, urlPath: result.url_path, previewUrl: result.preview_url },
      };
      return NextResponse.json(response);
    } else {
      const result = await chatWithDbAgent(history, accessToken);
      const lastAssistant = [...result.messages].reverse().find((msg) => msg.role === 'assistant');
      const replyText = lastAssistant?.content ?? (result.type === 'text' ? result.text : '');

      await appendMessage(session.id, 'assistant', replyText, { route: 'db' });

      const response: ChatTurnResponsePayload = {
        sessionId: session.id,
        reply: replyText,
        route: 'db',
        db: result,
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
