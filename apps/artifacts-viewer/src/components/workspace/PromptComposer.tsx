'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp, Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils/cn';

export interface PromptComposerProps {
  disabled?: boolean;
  onSend: (message: string) => void;
  placeholder?: string;
  leadingAction?: React.ReactNode;
  surface?: 'light' | 'dark';
}

export function PromptComposer({
  disabled,
  onSend,
  placeholder = 'Ask me to build a page or query your data…',
  leadingAction,
  surface = 'light',
}: PromptComposerProps) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
    if (ref.current) ref.current.style.height = 'auto';
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const autoGrow = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  };

  return (
    <div
      className={cn(
        'rounded-xl flex items-end gap-2 p-3',
        surface === 'dark' ? 'bg-white/5 border border-white/10' : 'bg-surface-raised border border-subtle',
      )}
    >
      {leadingAction}
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          autoGrow();
        }}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        rows={1}
        placeholder={placeholder}
        className={cn(
          'flex-1 resize-none bg-transparent outline-none text-[14px] py-2 max-h-[140px] disabled:opacity-60',
          surface === 'dark'
            ? 'text-[var(--panel-dark-text-primary)] placeholder:text-[var(--panel-dark-text-secondary)]'
            : 'text-primary placeholder:text-tertiary',
        )}
      />
      <button
        type="button"
        onClick={submit}
        disabled={disabled || !value.trim()}
        aria-label="Send"
        className="h-9 w-9 shrink-0 rounded-full bg-accent-500 text-on-accent flex items-center justify-center hover:bg-accent-600 disabled:opacity-40 disabled:pointer-events-none"
      >
        {disabled ? <Sparkles className="h-4 w-4 animate-pulse" /> : <ArrowUp className="h-4 w-4" />}
      </button>
    </div>
  );
}
