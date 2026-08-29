import { NextRequest, NextResponse } from 'next/server';
import { submitFormWithDbAgent, DbAgentServiceError } from '../../../lib/api/db-agent-service-client';
import { extractDataAuth } from '../../../lib/http/data-request-auth';
import type { SubmitFormRequestPayload } from '../../../lib/db-chat/types';

export async function POST(req: NextRequest) {
  const auth = extractDataAuth(req);
  if (!auth) {
    return NextResponse.json({ error: 'Authorization: Bearer <supabase access token> header is required' }, { status: 401 });
  }

  const payload = (await req.json()) as SubmitFormRequestPayload;

  try {
    const result = await submitFormWithDbAgent(payload, auth.accessToken);
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
