import 'server-only';
import { GoogleGenAI } from '@google/genai';

export class GeminiServiceError extends Error {}

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}

// '-latest' alias — always resolves to Google's current flash-tier model rather than a name that
// goes stale as new versions ship. Flash-tier models are multimodal (text + audio), so the same
// model/env var covers both transcription and translation below.
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';

/** Transcribes spoken audio to text in whatever language it was spoken in — no translation. */
export async function transcribeAudio(base64Audio: string, mimeType: string): Promise<string> {
  const response = await getClient().models.generateContent({
    model: MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: 'Transcribe exactly what is said in this audio clip, in the original spoken language. Respond with only the transcript text, no commentary, no quotation marks, no translation.',
          },
          { inlineData: { mimeType, data: base64Audio } },
        ],
      },
    ],
  });

  const text = response.text?.trim();
  if (!text) {
    throw new GeminiServiceError('No speech detected in the recording');
  }
  return text;
}

/** Translates text to English if it isn't already; returns it unchanged otherwise. */
export async function translateToEnglish(text: string): Promise<string> {
  const response = await getClient().models.generateContent({
    model: MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `Translate the following text to English if it is not already in English. If it is already in English, return it unchanged. Respond with ONLY the resulting text — no commentary, no explanation, no quotation marks.\n\nText:\n${text}`,
          },
        ],
      },
    ],
  });

  const translated = response.text?.trim();
  if (!translated) {
    throw new GeminiServiceError('Translation returned no text');
  }
  return translated;
}
