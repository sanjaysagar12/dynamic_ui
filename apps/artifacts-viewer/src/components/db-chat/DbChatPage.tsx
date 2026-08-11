'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { useSupabaseSession } from '../../lib/supabase/supabase-session-context';
import { sendDbChatMessage, DbChatRequestError } from '../../lib/api/db-chat-client';
import type { DbChatMessage } from '../../lib/db-chat/types';
import { SupabaseSessionWidget } from '../supabase/SupabaseSessionWidget';
import { theme } from '../../lib/ui/theme';

export function DbChatPage() {
  const { session } = useSupabaseSession();
  const token = session?.accessToken ?? null;
  const [messages, setMessages] = useState<DbChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState('');

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    const content = value.trim();
    if (!content || pending || !token) return;

    const nextMessages: DbChatMessage[] = [...messages, { role: 'user', content }];
    setMessages(nextMessages);
    setValue('');
    setPending(true);
    setError(null);

    try {
      // The Supabase JWT travels with every turn (via sendDbChatMessage's Authorization
      // header) — it's what lets supabase-service enforce RLS as this user, not as an admin.
      const response = await sendDbChatMessage(nextMessages, token);
      setMessages(response.messages);
    } catch (err) {
      setError(err instanceof DbChatRequestError ? err.message : 'Failed to reach the database agent');
    } finally {
      setPending(false);
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', background: theme.color.bg }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '480px',
          minWidth: '360px',
          margin: '0 auto',
          borderLeft: `1px solid ${theme.color.border}`,
          borderRight: `1px solid ${theme.color.border}`,
          background: theme.color.surface,
        }}
      >
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '1rem',
            borderBottom: `1px solid ${theme.color.border}`,
          }}
        >
          <Link href="/" style={{ fontSize: '0.85rem', color: theme.color.textMuted, textDecoration: 'none' }}>
            ← Viewer
          </Link>
          <span style={{ fontWeight: 600 }}>Database Chat</span>
          <Link href="/chat" style={{ fontSize: '0.85rem', color: theme.color.primary, textDecoration: 'none' }}>
            Artifact Chat →
          </Link>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          {messages.length === 0 && !pending && (
            <p style={{ color: theme.color.textMuted, fontSize: '0.9rem' }}>
              Ask a question about your data, e.g. &quot;how many open jobs are due this week?&quot;. Answers are scoped
              to what your own account is allowed to see.
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
            <div style={{ alignSelf: 'flex-start', color: theme.color.textMuted, padding: '0.6rem 0.85rem', fontSize: '0.9rem', fontStyle: 'italic' }}>
              Looking that up…
            </div>
          )}
        </div>

        {error && <p style={{ color: theme.color.danger, padding: '0 1rem', fontSize: '0.85rem' }}>{error}</p>}
        {!token && <p style={{ color: theme.color.textMuted, padding: '0 1rem', fontSize: '0.85rem' }}>Log in with Supabase to ask a question.</p>}

        <form onSubmit={handleSend} style={{ display: 'flex', gap: '0.5rem', padding: '0.85rem 1rem', borderTop: `1px solid ${theme.color.border}` }}>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={!token || pending}
            placeholder="Ask about your data…"
            style={{
              flex: 1,
              padding: '0.6rem 0.85rem',
              borderRadius: '999px',
              border: `1px solid ${theme.color.border}`,
              fontSize: '0.9rem',
              fontFamily: 'inherit',
            }}
          />
          <button
            type="submit"
            disabled={!token || pending || !value.trim()}
            style={{
              padding: '0.55rem 1.1rem',
              borderRadius: '999px',
              border: 'none',
              background: !token || pending || !value.trim() ? theme.color.border : theme.color.primary,
              color: !token || pending || !value.trim() ? theme.color.textMuted : theme.color.primaryText,
              fontSize: '0.9rem',
              fontWeight: 600,
              cursor: !token || pending || !value.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            Send
          </button>
        </form>

        <div style={{ borderTop: `1px solid ${theme.color.border}`, padding: '0.85rem 1rem' }}>
          <SupabaseSessionWidget popupPlacement="above" />
        </div>
      </div>
    </div>
  );
}
