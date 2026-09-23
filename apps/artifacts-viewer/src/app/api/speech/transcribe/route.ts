import { NextRequest, NextResponse } from 'next/server';
import { GeminiServiceError, transcribeAudio } from '../../../../lib/api/gemini-client';
import { extractAccessToken } from '../../../../lib/http/data-request-auth';
import { resolveUserId } from '../../../../lib/chat-sessions/auth';

export async function POST(req: NextRequest): Promise<NextResponse<{ transcript: string } | { error: string }>> {
  const accessToken = extractAccessToken(req);
  if (!accessToken) {
    return NextResponse.json({ error: 'Authorization: Bearer <access token> header is required' }, { status: 401 });
  }
  const userId = await resolveUserId(accessToken);
  if (!userId) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
  }

  const form = await req.formData().catch(() => null);
  const audio = form?.get('audio');
  if (!audio || !(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json({ error: 'audio file is required' }, { status: 400 });
  }

  const mimeType = audio.type || 'audio/webm';
  const buffer = Buffer.from(await audio.arrayBuffer());
  const base64Audio = buffer.toString('base64');

  try {
    const transcript = await transcribeAudio(base64Audio, mimeType);
    return NextResponse.json({ transcript });
  } catch (err) {
    console.error('Transcription failed:', err);
    const message = err instanceof GeminiServiceError ? err.message : 'Transcription failed — please try again';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
