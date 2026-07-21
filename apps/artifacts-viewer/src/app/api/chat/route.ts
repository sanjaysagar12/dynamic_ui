import { NextRequest, NextResponse } from 'next/server';
import { AgentServiceError, chatWithAgent } from '../../../lib/api/agent-service-client';
import type { ChatRequestPayload } from '../../../lib/chat/types';

export async function POST(req: NextRequest) {
  const payload = (await req.json()) as ChatRequestPayload;

  try {
    const result = await chatWithAgent(payload);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AgentServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'Unexpected error contacting agent service' }, { status: 502 });
  }
}
