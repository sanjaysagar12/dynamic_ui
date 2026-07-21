import { NextRequest, NextResponse } from 'next/server';
import { SupabaseServiceError, supabaseLogin } from '../../../../lib/api/supabase-service-client';

export async function POST(req: NextRequest) {
  const { email, password } = await req.json().catch(() => ({}));

  if (typeof email !== 'string' || typeof password !== 'string') {
    return NextResponse.json({ error: 'email and password are required' }, { status: 400 });
  }

  try {
    return NextResponse.json(await supabaseLogin(email, password));
  } catch (err) {
    if (err instanceof SupabaseServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'Unexpected error contacting the supabase service' }, { status: 502 });
  }
}
