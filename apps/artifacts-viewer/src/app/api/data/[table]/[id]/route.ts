import { NextRequest, NextResponse } from 'next/server';
import { proxyDataRequest } from '../../../../../lib/api/supabase-service-client';
import { extractDataAuth } from '../../../../../lib/http/data-request-auth';

function unauthorized() {
  return NextResponse.json({ error: 'Authorization: Bearer <supabase access token> header is required' }, { status: 401 });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ table: string; id: string }> }) {
  const { table, id } = await params;
  const auth = extractDataAuth(req);
  if (!auth) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const result = await proxyDataRequest({ method: 'PATCH', table, id, body, ...auth });
  return NextResponse.json(result.body, { status: result.status });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ table: string; id: string }> }) {
  const { table, id } = await params;
  const auth = extractDataAuth(req);
  if (!auth) return unauthorized();

  const result = await proxyDataRequest({ method: 'DELETE', table, id, ...auth });
  return new NextResponse(result.body ? JSON.stringify(result.body) : null, { status: result.status });
}
