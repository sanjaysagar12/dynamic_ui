import { NextRequest, NextResponse } from 'next/server';
import { executeTool } from '../../../../lib/api/tool-service-client';

// `login`/`register` deliberately do NOT go through this route — they're unauthenticated
// (requiresAuth: false on both tools) and conceptually distinct from data-bridge calls, so
// they get their own routes (app/api/tools/login, app/api/tools/register) instead of this
// one needing to special-case which tool names don't require a bearer token.
export async function POST(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;

  const header = req.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) {
    return NextResponse.json(
      { ok: false, error: 'Authorization: Bearer <token> header is required', code: 'UNAUTHENTICATED' },
      { status: 401 },
    );
  }
  const accessToken = header.slice('Bearer '.length).trim();

  const { args, confirmed } = await req.json().catch(() => ({}));

  const { status, body } = await executeTool(name, args, confirmed, accessToken);
  return NextResponse.json(body, { status });
}
