import { NextRequest, NextResponse } from 'next/server';
import { chatWithDbAgent, DbAgentServiceError } from '../../../lib/api/db-agent-service-client';
import { extractAccessToken } from '../../../lib/http/data-request-auth';
import type { DbChatRequestPayload } from '../../../lib/db-chat/types';

export async function POST(req: NextRequest) {
  const accessToken = extractAccessToken(req);
  if (!accessToken) {
    return NextResponse.json({ error: 'Authorization: Bearer <access token> header is required' }, { status: 401 });
  }

  const payload = (await req.json()) as DbChatRequestPayload;

  try {
    const result = await chatWithDbAgent(payload.messages, accessToken);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof DbAgentServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof Error && err.name === 'TimeoutError') {
      return NextResponse.json({ error: 'The database agent took too long to respond — try a simpler question.' }, { status: 504 });
    }
    return NextResponse.json({ error: 'Unexpected error contacting the database agent service' }, { status: 502 });
  }
}
