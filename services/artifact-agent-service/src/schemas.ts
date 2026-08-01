import { ROLES } from '@org/shared-auth';
import type { Provider } from './config.js';

export class ValidationError extends Error {}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

// Wire-format DTOs: field names intentionally mirror the previous FastAPI/
// pydantic JSON contract (snake_case) so the frontend needs zero changes.

export interface GenerateArtifactRequest {
  prompt: string;
  slug: string | null;
  roles: string[];
  provider: Provider | null;
  model: string | null;
}

export interface GenerateArtifactResponse {
  slug: string;
  title: string;
  reply: string;
  roles: string[];
  url_path: string;
  preview_url: string;
  files_written: string[];
  provider: Provider;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  slug: string | null;
  roles: string[];
  provider: Provider | null;
  model: string | null;
}

export interface ChatResponse {
  reply: string;
  slug: string;
  title: string;
  roles: string[];
  url_path: string;
  preview_url: string;
  files_written: string[];
  provider: Provider;
  messages: ChatMessage[];
}

export interface SkillSummary {
  name: string;
  description: string;
}

export interface Skill extends SkillSummary {
  content: string;
}

export interface ListSkillsResponse {
  skills: Skill[];
}

export interface CreateSkillRequest {
  name: string;
  description: string;
  content: string;
}

export interface UpdateSkillRequest {
  description: string;
  content: string;
}

export interface ProviderInfo {
  id: Provider;
  label: string;
  model: string;
}

export interface ProvidersResponse {
  default: Provider;
  providers: ProviderInfo[];
}

export function parseGenerateArtifactRequest(body: unknown): GenerateArtifactRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isNonEmptyString(b.prompt)) {
    throw new ValidationError('prompt is required and must be a non-empty string');
  }
  return {
    prompt: b.prompt,
    slug: isNonEmptyString(b.slug) ? b.slug : null,
    roles: Array.isArray(b.roles) && b.roles.length > 0 ? (b.roles as string[]) : [...ROLES],
    provider: (b.provider as Provider | null) ?? null,
    model: isNonEmptyString(b.model) ? b.model : null,
  };
}

export function parseChatRequest(body: unknown): ChatRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(b.messages) || b.messages.length === 0) {
    throw new ValidationError('messages must be a non-empty array');
  }
  for (const message of b.messages) {
    const m = message as Record<string, unknown>;
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') {
      throw new ValidationError('each message requires role ("user"|"assistant") and string content');
    }
  }
  return {
    messages: b.messages as ChatMessage[],
    slug: isNonEmptyString(b.slug) ? b.slug : null,
    roles: Array.isArray(b.roles) && b.roles.length > 0 ? (b.roles as string[]) : [...ROLES],
    provider: (b.provider as Provider | null) ?? null,
    model: isNonEmptyString(b.model) ? b.model : null,
  };
}

export function parseCreateSkillRequest(body: unknown): CreateSkillRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isNonEmptyString(b.name)) {
    throw new ValidationError('name is required and must be a non-empty string');
  }
  if (!isNonEmptyString(b.description)) {
    throw new ValidationError('description is required and must be a non-empty string');
  }
  if (!isNonEmptyString(b.content)) {
    throw new ValidationError('content is required and must be a non-empty string');
  }
  return { name: b.name, description: b.description, content: b.content };
}

export function parseUpdateSkillRequest(body: unknown): UpdateSkillRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isNonEmptyString(b.description)) {
    throw new ValidationError('description is required and must be a non-empty string');
  }
  if (!isNonEmptyString(b.content)) {
    throw new ValidationError('content is required and must be a non-empty string');
  }
  return { description: b.description, content: b.content };
}
