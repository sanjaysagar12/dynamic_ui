import { NextRequest, NextResponse } from 'next/server';
import { extractAccessToken } from '../../../../lib/http/data-request-auth';
import { resolveUserId } from '../../../../lib/chat-sessions/auth';
import { listSessionsForUser } from '../../../../lib/chat-sessions/store';
import type { ChatSessionSummaryDto } from '../../../../lib/chat-sessions/types';

/** Lists the caller's own chat sessions, newest first — for the sidebar (Part 4). */
export async function GET(req: NextRequest): Promise<NextResponse<ChatSessionSummaryDto[] | { error: string }>> {
  const accessToken = extractAccessToken(req);
  if (!accessToken) {
    return NextResponse.json({ error: 'Authorization: Bearer <access token> header is required' }, { status: 401 });
  }
  const userId = await resolveUserId(accessToken);
  if (!userId) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
  }

  const sessions = await listSessionsForUser(userId);
  const dtos: ChatSessionSummaryDto[] = sessions.map((s) => ({ id: s.id, title: s.title, updatedAt: s.updatedAt.toISOString() }));
  return NextResponse.json(dtos);
}
