export class SpeechTranscribeError extends Error {}

/** Sends a recorded audio blob to the server for Gemini transcription. Same Bearer-header JWT
 *  pattern as chatWithUnifiedAgent/submitDbChatForm. */
export async function transcribeAudio(audio: Blob, token: string): Promise<string> {
  const form = new FormData();
  form.append('audio', audio, 'recording.webm');

  const response = await fetch('/api/speech/transcribe', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new SpeechTranscribeError(body.error || `Transcription failed (status ${response.status})`);
  }

  return body.transcript as string;
}
