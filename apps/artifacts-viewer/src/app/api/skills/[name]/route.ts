import { NextRequest, NextResponse } from 'next/server';
import { AgentServiceError, deleteSkillOnAgent, updateSkillOnAgent } from '../../../../lib/api/artifact-agent-service-client';
import type { UpdateSkillPayload } from '../../../../lib/skills/types';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const payload = (await req.json()) as UpdateSkillPayload;

  try {
    const result = await updateSkillOnAgent(name, payload);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AgentServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'Unexpected error contacting agent service' }, { status: 502 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;

  try {
    await deleteSkillOnAgent(name);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof AgentServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'Unexpected error contacting agent service' }, { status: 502 });
  }
}
