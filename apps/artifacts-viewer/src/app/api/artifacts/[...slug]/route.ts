import { NextRequest, NextResponse } from 'next/server';
import { ArtifactsCatalogError, deleteArtifact, renameArtifact } from '../../../../lib/api/artifacts-catalog-client';

function requireBearer(req: NextRequest): string | null {
  const header = req.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const accessToken = requireBearer(req);
  if (!accessToken) {
    return NextResponse.json(
      { error: 'Authorization: Bearer <access token> header is required' },
      { status: 401 },
    );
  }

  try {
    await deleteArtifact(slug.join('/'), accessToken);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof ArtifactsCatalogError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'Unexpected error contacting artifacts server' }, { status: 502 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const accessToken = requireBearer(req);
  if (!accessToken) {
    return NextResponse.json(
      { error: 'Authorization: Bearer <access token> header is required' },
      { status: 401 },
    );
  }

  const body = await req.json().catch(() => ({}));
  if (typeof body.title !== 'string' || !body.title.trim()) {
    return NextResponse.json({ error: 'title is required' }, { status: 422 });
  }

  try {
    await renameArtifact(slug.join('/'), body.title.trim(), accessToken);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof ArtifactsCatalogError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'Unexpected error contacting artifacts server' }, { status: 502 });
  }
}
