import { NextRequest, NextResponse } from 'next/server';
import { submitFormWithDbAgent, DbAgentServiceError } from '../../../lib/api/db-agent-service-client';
import { extractAccessToken } from '../../../lib/http/data-request-auth';
import { resolveUserId } from '../../../lib/chat-sessions/auth';
import { appendMessage, getSessionById } from '../../../lib/chat-sessions/store';
import type { SubmitFormRequestPayload } from '../../../lib/db-chat/types';

export async function POST(req: NextRequest) {
  const accessToken = extractAccessToken(req);
  if (!accessToken) {
    return NextResponse.json({ error: 'Authorization: Bearer <access token> header is required' }, { status: 401 });
  }

  const payload = (await req.json()) as SubmitFormRequestPayload;

  try {
    const result = await submitFormWithDbAgent(payload, accessToken);

    // A post-write hook's follow-up reply (db-agent-service/services/post-write-hooks.ts) is new
    // information generated after the form_request turn already in history — persist it so it's
    // part of the conversation on reload, exactly like any other assistant reply. Every other
    // submit-form outcome (no hook registered, or a rejection that reopens the form) is
    // unchanged: still returned in the HTTP response only, never written to the session, same as
    // before this feature. Best-effort: a session-lookup failure here still returns the
    // already-successful write to the caller, it just isn't persisted.
    if (result.type === 'text' && result.postWriteFollowUp && payload.sessionId) {
      const userId = await resolveUserId(accessToken);
      if (userId) {
        const session = await getSessionById(payload.sessionId);
        if (session && session.userId === userId) {
          await appendMessage(payload.sessionId, 'assistant', result.text, { route: 'db' });
        }
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof DbAgentServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof Error && err.name === 'TimeoutError') {
      return NextResponse.json({ error: 'The database agent took too long to respond — try again.' }, { status: 504 });
    }
    return NextResponse.json({ error: 'Unexpected error contacting the database agent service' }, { status: 502 });
  }
}
