import { NextRequest, NextResponse } from 'next/server';
import { isRole } from '@org/shared-auth';
import { ArtifactsCatalogError, listArtifactsForRole } from '../../../lib/api/artifacts-catalog-client';

export async function GET(req: NextRequest) {
  const role = req.nextUrl.searchParams.get('role');

  if (!role || !isRole(role)) {
    return NextResponse.json({ error: 'Query parameter "role" must be a valid role' }, { status: 400 });
  }

  try {
    const artifacts = await listArtifactsForRole(role);
    return NextResponse.json({ artifacts });
  } catch (err) {
    if (err instanceof ArtifactsCatalogError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'Unexpected error contacting artifacts server' }, { status: 502 });
  }
}
