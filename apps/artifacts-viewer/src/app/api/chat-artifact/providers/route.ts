import { NextResponse } from 'next/server';
import { AgentServiceError, listAgentProviders } from '../../../../lib/api/artifact-agent-service-client';

export async function GET() {
  try {
    const result = await listAgentProviders();
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AgentServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'Unexpected error contacting agent service' }, { status: 502 });
  }
}
