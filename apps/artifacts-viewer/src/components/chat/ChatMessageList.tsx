'use client';

import type { ChatMessage } from '../../lib/chat/types';

export interface ChatMessageListProps {
  messages: ChatMessage[];
  pending: boolean;
}

export function ChatMessageList({ messages, pending }: ChatMessageListProps) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {messages.length === 0 && !pending && (
        <p style={{ color: '#888' }}>Describe the page you want to create, e.g. &quot;a simple todo list app&quot;.</p>
      )}
      {messages.map((message, index) => (
        <div
          key={index}
          style={{
            alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '80%',
            background: message.role === 'user' ? '#0366d6' : '#f0f0f0',
            color: message.role === 'user' ? '#fff' : '#111',
            padding: '0.5rem 0.75rem',
            borderRadius: '0.75rem',
            whiteSpace: 'pre-wrap',
          }}
        >
          {message.content}
        </div>
      ))}
      {pending && (
        <div style={{ alignSelf: 'flex-start', color: '#888', padding: '0.5rem 0.75rem' }}>Thinking…</div>
      )}
    </div>
  );
}
