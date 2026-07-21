import { NextRequest, NextResponse } from 'next/server';
import { proxyDataRequest } from '../../../../lib/api/supabase-service-client';
import { extractDataAuth } from '../../../../lib/http/data-request-auth';

function unauthorized() {
  return NextResponse.json({ error: 'Authorization: Bearer <supabase access token> header is required' }, { status: 401 });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ table: string }> }) {
  const { table } = await params;
  const auth = extractDataAuth(req);
  if (!auth) return unauthorized();

  const search = req.nextUrl.search.replace(/^\?/, '');
  const result = await proxyDataRequest({ method: 'GET', table, search, ...auth });
  return NextResponse.json(result.body, { status: result.status });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ table: string }> }) {
  const { table } = await params;
  const auth = extractDataAuth(req);
  if (!auth) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const result = await proxyDataRequest({ method: 'POST', table, body, ...auth });
  return NextResponse.json(result.body, { status: result.status });
}
