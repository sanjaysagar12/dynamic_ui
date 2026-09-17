'use client';

import { Sparkles, LayoutDashboard, Database, Users2, Rocket, MonitorSmartphone } from 'lucide-react';
import type { DbChatResponsePayload } from '../../lib/db-chat/types';
import { MessageBubble, type DisplayMessage } from '../chat/MessageBubble';
import { ChatPanel } from './ChatPanel';

type PendingRich = Extract<DbChatResponsePayload, { type: 'form_request' | 'table' | 'chart' | 'card' }>;

const INITIAL_SUGGESTIONS = [
  'Build a landing page for a coffee subscription brand',
  'Show me last month’s total sales from the database',
  'Create a dashboard page for tracking inventory',
  'How many materials are currently low in stock?',
];

const FOLLOW_UP_SUGGESTIONS = [
  'Add a chart to the page you just built',
  'What else is running low on stock?',
  'Show me the status of recent orders',
  'Build another page for supplier tracking',
];

export interface AssistantPageProps {
  messages: DisplayMessage[];
  pending: boolean;
  error: string | null;
  pendingRich: PendingRich | null;
  token: string;
  artifactTitles: Record<string, string>;
  selectedSkills: string[];
  onSelectedSkillsChange: (names: string[]) => void;
  onSend: (message: string) => void;
  onOpenArtifact: (slug: string) => void;
  onFormDone: (messages: DisplayMessage[]) => void;
  onFormMessagesUpdate: (messages: DisplayMessage[]) => void;
  onFormCancel: () => void;
}

export function AssistantPage(props: AssistantPageProps) {
  const { messages, ...chatPanelProps } = props;
  const hasConversation = messages.length > 0;

  return (
    <div className="flex-1 min-h-0 flex gap-6 p-8 pt-0 overflow-hidden">
      <div className="flex-[2] min-w-0 flex flex-col bg-surface border border-subtle rounded-xl shadow-card overflow-hidden">
        <div className="shrink-0 flex items-center gap-3 px-6 h-16 border-b border-subtle">
          <div className="h-9 w-9 rounded-full bg-accent-gradient flex items-center justify-center shrink-0">
            <Sparkles className="h-4 w-4 text-on-accent" />
          </div>
          <div className="min-w-0">
            <div className="text-h2 text-primary truncate">Dynamic UI Assistant</div>
            <div className="text-[12px] text-tertiary truncate">Ask about your data, or tell me what to build</div>
          </div>
        </div>

        <ChatPanel
          messages={messages}
          variant="split"
          surface="light"
          suggestions={hasConversation ? FOLLOW_UP_SUGGESTIONS : INITIAL_SUGGESTIONS}
          onSelectSuggestion={chatPanelProps.onSend}
          leadingContent={
            !hasConversation ? (
              <MessageBubble
                message={{
                  role: 'assistant',
                  content:
                    "Hi, welcome to your workspace. It's empty right now — I'll build each page live as you ask for it. Try “Build me a dashboard” to get started.",
                }}
                surface="light"
              />
            ) : null
          }
          {...chatPanelProps}
        />
      </div>

      <div className="w-[320px] shrink-0 flex flex-col gap-5 overflow-y-auto">
        <div className="bg-surface border border-subtle rounded-xl shadow-card p-5">
          <div className="text-micro text-tertiary mb-3">WHAT I CAN HELP WITH</div>
          <ul className="flex flex-col gap-3">
            {[
              { icon: LayoutDashboard, text: 'Build whole pages for you, live, in this workspace' },
              { icon: Database, text: 'Check current stock and low-stock materials' },
              { icon: MonitorSmartphone, text: 'Look up the status of any order or record' },
              { icon: Users2, text: 'Get supplier or contact details on request' },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-2.5">
                <div className="h-6 w-6 rounded-md bg-accent-soft flex items-center justify-center shrink-0 mt-0.5">
                  <Icon className="h-3.5 w-3.5 text-accent-500" />
                </div>
                <span className="text-[13px] text-secondary leading-relaxed">{text}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-surface border border-subtle rounded-xl shadow-card p-5">
          <div className="text-micro text-tertiary mb-3">ONCE YOU BUILD YOUR FIRST PAGE</div>
          <p className="text-[13px] text-secondary leading-relaxed">
            It's added to your sidebar under <strong className="text-primary">WORKSPACE</strong> so you can jump
            back to it anytime. Ask me to add widgets, change the layout, or pull in new data — I'll update it live.
          </p>
        </div>

        <div className="bg-surface border border-subtle rounded-xl shadow-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <Rocket className="h-4 w-4 text-accent-500" />
            <span className="text-micro text-tertiary">ALWAYS AVAILABLE</span>
          </div>
          <p className="text-[13px] text-secondary leading-relaxed">
            Once a page is built, I follow you there as a floating chat button, so you can keep asking for changes
            without losing sight of the page itself.
          </p>
        </div>
      </div>
    </div>
  );
}
