import { NextRequest, NextResponse } from 'next/server';
import { ArtifactsCatalogError, listArtifacts } from '../../../lib/api/artifacts-catalog-client';

export async function GET(req: NextRequest) {
  const header = req.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: 'Authorization: Bearer <supabase access token> header is required' },
      { status: 401 },
    );
  }
  const accessToken = header.slice('Bearer '.length).trim();

  try {
    const { role, artifacts } = await listArtifacts(accessToken);
    return NextResponse.json({ role, artifacts });
  } catch (err) {
    if (err instanceof ArtifactsCatalogError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'Unexpected error contacting artifacts server' }, { status: 502 });
  }
}
