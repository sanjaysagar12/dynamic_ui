import { NextRequest, NextResponse } from 'next/server';
import { ROLES } from '@org/shared-types';
import { ArtifactsCatalogError, deleteArtifact, renameArtifact } from '../../../../lib/api/artifacts-catalog-client';
import { AgentServiceError, chatWithAgent } from '../../../../lib/api/artifact-agent-service-client';
import type { ChatRequestPayload } from '../../../../lib/chat/types';

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

// Edits an existing artifact's content via opencode — the "Edit" entry point in the sidebar's
// 3-dot menu (ArtifactListItem.tsx), distinct from PATCH's metadata-only rename above. On the
// same catch-all route (not a nested `edit/` segment) because Next.js requires a catch-all
// segment to be the last part of its route. Deliberately NOT OWNER-gated like DELETE/PATCH:
// editing content this way is the same action as continuing the chat on an already-open artifact,
// which every role can already do — this is just a more discoverable entry point for it, not a
// more privileged one. No sessionId/chat history is threaded through: `slug` alone is enough to
// tell artifact-agent-service which artifact to continue (chat-service.ts's isNew=false path),
// and sending only this one prompt — not a reconstructed session transcript — is exactly what
// keeps its edits from getting confused by unrelated turns (see chat-service.ts's
// latestMessage/renderTranscript split).
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const accessToken = requireBearer(req);
  if (!accessToken) {
    return NextResponse.json({ error: 'Authorization: Bearer <access token> header is required' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
    return NextResponse.json({ error: 'prompt is required' }, { status: 422 });
  }

  const payload: ChatRequestPayload = {
    messages: [{ role: 'user', content: body.prompt.trim() }],
    slug: slug.join('/'),
    roles: ROLES.slice(),
  };

  try {
    const result = await chatWithAgent(payload);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AgentServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'Unexpected error contacting agent service' }, { status: 502 });
  }
}
