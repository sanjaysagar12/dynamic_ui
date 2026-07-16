import { NextRequest, NextResponse } from 'next/server';
import { BackendServiceError, requestDevToken } from '../../../lib/api/backend-service-client';

export async function GET(req: NextRequest) {
  const role = req.nextUrl.searchParams.get('role');

  if (!role) {
    return NextResponse.json({ error: 'Query parameter "role" is required' }, { status: 400 });
  }

  try {
    const { token } = await requestDevToken(role);
    return NextResponse.json({ token });
  } catch (err) {
    if (err instanceof BackendServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'Unexpected error contacting backend service' }, { status: 502 });
  }
}
