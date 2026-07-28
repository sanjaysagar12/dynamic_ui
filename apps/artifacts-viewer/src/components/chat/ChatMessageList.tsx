'use client';

import type { ChatMessage } from '../../lib/chat/types';
import { theme } from '../../lib/ui/theme';

export interface ChatMessageListProps {
  messages: ChatMessage[];
  pending: boolean;
}

export function ChatMessageList({ messages, pending }: ChatMessageListProps) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
      {messages.length === 0 && !pending && (
        <p style={{ color: theme.color.textMuted, fontSize: '0.9rem' }}>
          Describe the page you want to create, e.g. &quot;a simple todo list app&quot;.
        </p>
      )}
      {messages.map((message, index) => (
        <div
          key={index}
          style={{
            alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '82%',
            background: message.role === 'user' ? theme.color.primary : theme.color.surface,
            color: message.role === 'user' ? theme.color.primaryText : theme.color.text,
            border: message.role === 'user' ? 'none' : `1px solid ${theme.color.border}`,
            padding: '0.6rem 0.85rem',
            borderRadius: '0.9rem',
            borderBottomRightRadius: message.role === 'user' ? '0.2rem' : '0.9rem',
            borderBottomLeftRadius: message.role === 'assistant' ? '0.2rem' : '0.9rem',
            whiteSpace: 'pre-wrap',
            fontSize: '0.9rem',
            lineHeight: 1.45,
            boxShadow: message.role === 'assistant' ? theme.shadow : 'none',
          }}
        >
          {message.content}
        </div>
      ))}
      {pending && (
        <div
          style={{
            alignSelf: 'flex-start',
            color: theme.color.textMuted,
            padding: '0.6rem 0.85rem',
            fontSize: '0.9rem',
            fontStyle: 'italic',
          }}
        >
          Thinking…
        </div>
      )}
    </div>
  );
}
