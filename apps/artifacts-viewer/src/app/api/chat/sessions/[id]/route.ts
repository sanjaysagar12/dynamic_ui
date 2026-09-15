import { NextRequest, NextResponse } from 'next/server';
import { extractAccessToken } from '../../../../../lib/http/data-request-auth';
import { resolveUserId } from '../../../../../lib/chat-sessions/auth';
import {
  deleteSession,
  getCurrentArtifactSlug,
  getFullHistory,
  getSessionById,
  renameSession,
} from '../../../../../lib/chat-sessions/store';
import type { ChatSessionDetailDto, ChatSessionSummaryDto, RenameChatSessionPayload } from '../../../../../lib/chat-sessions/types';
import type { AgentType } from '../../../../../lib/unified-chat/types';
import type { ChatSession } from '../../../../../generated/prisma-client';

type AuthorizeResult = { error: NextResponse<{ error: string }> } | { session: ChatSession };

/** Resolves the caller's identity and confirms they own `sessionId`. Returns either the owned
 *  session row or a ready-to-return error response — a user must never read, rename, delete, or
 *  append to another user's session. */
async function authorizeOwnSession(req: NextRequest, sessionId: string): Promise<AuthorizeResult> {
  const accessToken = extractAccessToken(req);
  if (!accessToken) {
    return { error: NextResponse.json({ error: 'Authorization: Bearer <access token> header is required' }, { status: 401 }) };
  }
  const userId = await resolveUserId(accessToken);
  if (!userId) {
    return { error: NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 }) };
  }
  const session = await getSessionById(sessionId);
  if (!session) {
    return { error: NextResponse.json({ error: 'Session not found' }, { status: 404 }) };
  }
  if (session.userId !== userId) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { session };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<ChatSessionDetailDto | { error: string }>> {
  const { id } = await params;
  const result = await authorizeOwnSession(req, id);
  if ('error' in result) return result.error;

  const [messages, currentArtifactSlug] = await Promise.all([getFullHistory(id), getCurrentArtifactSlug(id)]);
  const dto: ChatSessionDetailDto = {
    id: result.session.id,
    title: result.session.title,
    currentArtifactSlug,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: m.content,
      route: m.route as AgentType | null,
      artifactSlug: m.artifactSlug,
      createdAt: m.createdAt.toISOString(),
    })),
  };
  return NextResponse.json(dto);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  const result = await authorizeOwnSession(req, id);
  if ('error' in result) return result.error;

  await deleteSession(id);
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<ChatSessionSummaryDto | { error: string }>> {
  const { id } = await params;
  const result = await authorizeOwnSession(req, id);
  if ('error' in result) return result.error;

  const body = (await req.json().catch(() => null)) as RenameChatSessionPayload | null;
  if (!body || typeof body.title !== 'string' || !body.title.trim()) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }

  const updated = await renameSession(id, body.title.trim());
  return NextResponse.json({ id: updated.id, title: updated.title, updatedAt: updated.updatedAt.toISOString() });
}
