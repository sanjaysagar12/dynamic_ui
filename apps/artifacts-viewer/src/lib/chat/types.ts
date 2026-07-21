import type { Role } from '@org/shared-auth';

export type Provider = 'claude' | 'gemini';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequestPayload {
  messages: ChatMessage[];
  slug: string | null;
  roles: Role[];
  provider: Provider;
}

export interface ChatResponsePayload {
  reply: string;
  slug: string;
  title: string;
  roles: Role[];
  url_path: string;
  preview_url: string;
  files_written: string[];
  provider: Provider;
  messages: ChatMessage[];
}

export interface ProviderInfo {
  id: Provider;
  label: string;
  model: string;
}

export interface ProvidersResponsePayload {
  default: Provider;
  providers: ProviderInfo[];
}
