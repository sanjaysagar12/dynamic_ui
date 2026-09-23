import { NextResponse } from 'next/server';
import { fetchToolCatalog } from '../../../lib/api/tool-service-client';

// Public metadata — no auth required, same as tool-service's own GET /tools.
// Backs useToolCatalog.ts, which useArtifactDataBridge.ts uses as the real
// authority on whether a tool call needs a confirmation dialog, instead of
// trusting whatever `confirmed` value an artifact's own JS sent.
export async function GET() {
  try {
    const catalog = await fetchToolCatalog();
    return NextResponse.json(catalog);
  } catch {
    return NextResponse.json({ tools: [] }, { status: 502 });
  }
}
