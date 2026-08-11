import { NextRequest, NextResponse } from 'next/server';
import { AgentServiceError, createSkillOnAgent, listSkillsFromAgent } from '../../../lib/api/artifact-agent-service-client';
import type { CreateSkillPayload } from '../../../lib/skills/types';

export async function GET() {
  try {
    const result = await listSkillsFromAgent();
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AgentServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'Unexpected error contacting agent service' }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const payload = (await req.json()) as CreateSkillPayload;

  try {
    const result = await createSkillOnAgent(payload);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof AgentServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'Unexpected error contacting agent service' }, { status: 502 });
  }
}
