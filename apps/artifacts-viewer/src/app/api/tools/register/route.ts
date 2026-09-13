import { NextRequest, NextResponse } from 'next/server';
import { toolServiceRegister } from '../../../../lib/api/tool-service-client';

export async function POST(req: NextRequest) {
  const { email, password, role } = await req.json().catch(() => ({}));

  if (typeof email !== 'string' || typeof password !== 'string') {
    return NextResponse.json({ ok: false, error: 'email and password are required', code: 'INVALID_ARGS' }, { status: 400 });
  }

  const { status, body } = await toolServiceRegister(email, password, typeof role === 'string' ? role : undefined);
  return NextResponse.json(body, { status });
}
