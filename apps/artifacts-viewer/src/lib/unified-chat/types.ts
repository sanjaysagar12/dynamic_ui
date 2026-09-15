import type { Role } from '@org/shared-types';
import type { ChatMessage, ChatResponsePayload } from '../chat/types';
import type { DbChatResponsePayload } from '../db-chat/types';

export type AgentType = 'artifact' | 'db';

export interface UnifiedChatRequestPayload {
  messages: ChatMessage[];
  slug?: string | null;
  roles?: Role[];
}

export type UnifiedChatResponsePayload =
  | (ChatResponsePayload & { type: 'artifact' })
  | { type: 'db'; response: DbChatResponsePayload; agentType: 'db' };
