'use client';

import { useEffect, useRef, useState } from 'react';
import { BookOpen, Sparkles } from 'lucide-react';
import type { DbChatMessage, DbChatResponsePayload } from '../../lib/db-chat/types';
import { MessageBubble, type DisplayMessage } from '../chat/MessageBubble';
import { TypingIndicator } from '../chat/TypingIndicator';
import { SkillsDialog } from '../chat/SkillsDialog';
import { DynamicForm } from '../db-chat/DynamicForm';
import { DataTable } from '../db-chat/DataTable';
import { DataChart } from '../db-chat/DataChart';
import { DataCard } from '../db-chat/DataCard';
import { PromptComposer } from './PromptComposer';
import { cn } from '../../lib/utils/cn';

type PendingRich = Extract<DbChatResponsePayload, { type: 'form_request' | 'table' | 'chart' | 'card' }>;

export interface ChatPanelProps {
  messages: DisplayMessage[];
  pending: boolean;
  error: string | null;
  pendingRich: PendingRich | null;
  token: string;
  // The active chat session, if any — forwarded to DynamicForm so a post-write hook's follow-up
  // reply can be persisted into it (see /api/submit-form).
  sessionId?: string;
  artifactTitles: Record<string, string>;
  selectedSkills: string[];
  onSelectedSkillsChange: (names: string[]) => void;
  onSend: (message: string) => void;
  onOpenArtifact: (slug: string) => void;
  onFormDone: (messages: DisplayMessage[]) => void;
  onFormMessagesUpdate: (messages: DisplayMessage[]) => void;
  onFormCancel: () => void;
  /** 'full' centers a comfortable reading column (no artifact open); 'split' fills the narrower
   *  right-hand column next to the canvas panel. */
  variant: 'full' | 'split';
  /** 'light' = embedded in the full-page assistant's white card; 'dark' = the floating
   *  per-page assistant panel (new-prompt.md §5.6). */
  surface?: 'light' | 'dark';
  /** Contextual suggestion chips shown between the thread and the composer (§4.2/§5.6). */
  suggestions?: string[];
  onSelectSuggestion?: (suggestion: string) => void;
  /** Rendered above the real message list, e.g. a static welcome bubble before the first turn. */
  leadingContent?: React.ReactNode;
}

function toDisplayMessages(messages: DbChatMessage[]): DisplayMessage[] {
  return messages.map((m) => ({ role: m.role, content: m.content, artifactSlug: null }));
}

export function ChatPanel({
  messages,
  pending,
  error,
  pendingRich,
  token,
  sessionId,
  artifactTitles,
  selectedSkills,
  onSelectedSkillsChange,
  onSend,
  onOpenArtifact,
  onFormDone,
  onFormMessagesUpdate,
  onFormCancel,
  variant,
  surface = 'light',
  suggestions,
  onSelectSuggestion,
  leadingContent,
}: ChatPanelProps) {
  const [skillsOpen, setSkillsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, pending, pendingRich]);

  const lastIsAssistant = messages.length > 0 && messages[messages.length - 1].role === 'assistant';
  const inlineRich = pendingRich && pendingRich.type !== 'form_request' && lastIsAssistant ? pendingRich : null;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 py-5">
        <div className={cn('flex flex-col gap-4 w-full', variant === 'full' && 'max-w-[760px] mx-auto')}>
          {leadingContent}
          {messages.map((message, i) => (
            <MessageBubble
              key={i}
              message={message}
              artifactTitle={message.artifactSlug ? artifactTitles[message.artifactSlug] : undefined}
              onOpenArtifact={onOpenArtifact}
              surface={surface}
            />
          ))}

          {inlineRich && (
            <div className="ml-[34px]">
              {inlineRich.type === 'table' && <DataTable display={inlineRich.display} rows={inlineRich.rows} />}
              {inlineRich.type === 'chart' && <DataChart display={inlineRich.display} rows={inlineRich.rows} />}
              {inlineRich.type === 'card' && <DataCard display={inlineRich.display} data={inlineRich.data} />}
            </div>
          )}

          {pending && (
            <div className="flex gap-2.5">
              <div className="h-6 w-6 rounded-full bg-accent-500 flex items-center justify-center shrink-0 mt-0.5">
                <Sparkles className="h-3 w-3 text-on-accent" />
              </div>
              <TypingIndicator surface={surface} />
            </div>
          )}

          {pendingRich?.type === 'form_request' && (
            <DynamicForm
              toolName={pendingRich.toolName}
              form={pendingRich.form}
              prefill={pendingRich.prefill}
              messages={messages}
              token={token}
              sessionId={sessionId}
              onDone={(next) => onFormDone(toDisplayMessages(next))}
              onMessagesUpdate={(next) => onFormMessagesUpdate(toDisplayMessages(next))}
              onCancel={onFormCancel}
            />
          )}

          {error && <p className="text-negative text-[13px]">{error}</p>}
        </div>
      </div>

      <div className="shrink-0 px-4 md:px-6 pb-5">
        <div className={cn('w-full', variant === 'full' && 'max-w-[760px] mx-auto')}>
          {suggestions && suggestions.length > 0 && !pending && (
            <div className="flex flex-wrap gap-2 mb-3">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => onSelectSuggestion?.(suggestion)}
                  className={cn(
                    'text-[13px] rounded-full px-3.5 py-1.5 border transition-colors',
                    surface === 'dark'
                      ? 'text-[var(--panel-dark-text-secondary)] border-[var(--panel-dark-border)] hover:text-[var(--panel-dark-text-primary)] hover:bg-white/5'
                      : 'text-secondary border-subtle hover:text-primary hover:bg-surface-raised',
                  )}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}
          <PromptComposer
            disabled={pending}
            onSend={onSend}
            surface={surface}
            token={token}
            leadingAction={
              <button
                type="button"
                onClick={() => setSkillsOpen(true)}
                aria-label="Skills"
                title="Skills"
                className={cn(
                  'relative h-9 w-9 shrink-0 rounded-full flex items-center justify-center border',
                  surface === 'dark'
                    ? 'border-white/10 text-[var(--panel-dark-text-secondary)] hover:text-[var(--panel-dark-text-primary)] hover:bg-white/5'
                    : 'border-subtle text-secondary hover:text-primary hover:bg-surface-hover',
                  selectedSkills.length > 0 && 'text-accent-400 border-accent-500/40',
                )}
              >
                <BookOpen className="h-4 w-4" />
                {selectedSkills.length > 0 && (
                  <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-accent-500 text-on-accent text-[10px] font-bold flex items-center justify-center">
                    {selectedSkills.length}
                  </span>
                )}
              </button>
            }
          />
        </div>
      </div>

      <SkillsDialog open={skillsOpen} onOpenChange={setSkillsOpen} selected={selectedSkills} onSelectedChange={onSelectedSkillsChange} />
    </div>
  );
}
