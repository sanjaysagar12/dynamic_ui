'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { theme } from '../../lib/ui/theme';

export interface ChatComposerProps {
  disabled: boolean;
  onSend: (message: string) => void;
}

export function ChatComposer({ disabled, onSend }: ChatComposerProps) {
  const [value, setValue] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  };

  return (
    <form
      onSubmit={submit}
      style={{ display: 'flex', gap: '0.5rem', padding: '0.85rem 1rem', borderTop: `1px solid ${theme.color.border}` }}
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        placeholder="Describe the page you want…"
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
        disabled={disabled || !value.trim()}
        style={{
          padding: '0.55rem 1.1rem',
          borderRadius: '999px',
          border: 'none',
          background: disabled || !value.trim() ? theme.color.border : theme.color.primary,
          color: disabled || !value.trim() ? theme.color.textMuted : theme.color.primaryText,
          fontSize: '0.9rem',
          fontWeight: 600,
          cursor: disabled || !value.trim() ? 'not-allowed' : 'pointer',
        }}
      >
        Send
      </button>
    </form>
  );
}
