import type { Role } from '@org/shared-types';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequestPayload {
  messages: ChatMessage[];
  slug: string | null;
  roles: Role[];
}

export interface ChatResponsePayload {
  reply: string;
  slug: string;
  title: string;
  roles: Role[];
  url_path: string;
  preview_url: string;
  files_written: string[];
  messages: ChatMessage[];
}
