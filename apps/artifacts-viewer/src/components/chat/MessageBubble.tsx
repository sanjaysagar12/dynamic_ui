'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils/cn';
import { CopyButton } from './CopyButton';
import { ArtifactReferenceChip } from './ArtifactReferenceChip';

export interface DisplayMessage {
  role: 'user' | 'assistant';
  content: string;
  artifactSlug?: string | null;
}

export interface MessageBubbleProps {
  message: DisplayMessage;
  artifactTitle?: string;
  onOpenArtifact?: (slug: string) => void;
  /** 'light' = the full-page assistant's white card (new-prompt.md §4.2); 'dark' = the
   *  floating per-page assistant panel, a deliberately-dark surface (§5.6). Only the
   *  assistant bubble's fill changes — the user bubble stays accent-blue/gradient either way. */
  surface?: 'light' | 'dark';
}

const markdownComponents = {
  pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  code(props: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) {
    const { className, children } = props;
    const match = /language-(\w+)/.exec(className ?? '');
    const raw = String(children ?? '');
    const isBlock = Boolean(match) || raw.includes('\n');

    if (!isBlock) {
      return <code className="bg-surface-raised rounded px-1.5 py-0.5 text-[13px] font-mono text-primary">{children}</code>;
    }

    const codeText = raw.replace(/\n$/, '');
    return (
      <span className="my-3 block rounded-md border border-subtle bg-surface-raised overflow-hidden">
        <span className="flex items-center justify-between px-3 py-1.5 border-b border-subtle">
          <span className="text-[11px] text-tertiary uppercase tracking-wide">{match?.[1] ?? 'text'}</span>
          <CopyButton text={codeText} />
        </span>
        <pre className="overflow-x-auto p-3 text-[13px] font-mono text-primary">
          <code>{children}</code>
        </pre>
      </span>
    );
  },
  a: ({ children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...rest} className="text-accent-400 hover:underline" target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="my-3 overflow-x-auto rounded-md border border-subtle">
      <table className="w-full text-[13px]">{children}</table>
    </div>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="text-left px-3 py-2 text-secondary font-semibold border-b border-subtle bg-surface-raised">{children}</th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => <td className="px-3 py-2 border-b border-subtle">{children}</td>,
};

export function MessageBubble({ message, artifactTitle, onOpenArtifact, surface = 'light' }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isDark = surface === 'dark';

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-accent-gradient rounded-lg px-3.5 py-2.5 text-[14px] text-on-accent whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2.5">
      <div className="h-6 w-6 rounded-full bg-accent-500 flex items-center justify-center shrink-0 mt-0.5">
        <Sparkles className="h-3 w-3 text-on-accent" />
      </div>
      <div
        className={cn(
          'min-w-0 flex-1 max-w-[85%] rounded-lg px-3.5 py-2.5 text-[14px] leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
          isDark ? 'bg-panel-dark-surface panel-dark-text-primary' : 'bg-surface-raised text-primary',
        )}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {message.content}
        </ReactMarkdown>
        {message.artifactSlug && (
          <ArtifactReferenceChip
            title={artifactTitle ?? message.artifactSlug}
            onClick={() => onOpenArtifact?.(message.artifactSlug as string)}
          />
        )}
      </div>
    </div>
  );
}

export const messageBubbleWrapperClass = cn('flex flex-col gap-4');
