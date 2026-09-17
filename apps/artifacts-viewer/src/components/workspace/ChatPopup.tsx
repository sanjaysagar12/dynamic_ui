'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { MessageCircle, X, Sparkles } from 'lucide-react';
import { ChatPanel, type ChatPanelProps } from './ChatPanel';

export interface ChatPopupProps extends Omit<ChatPanelProps, 'variant' | 'surface' | 'suggestions' | 'onSelectSuggestion'> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The page currently open behind the popup — used to build contextual widget-add chips (§5.6). */
  pageTitle: string;
}

export function ChatPopup({ open, onOpenChange, pageTitle, ...chatPanelProps }: ChatPopupProps) {
  const suggestions = [
    `Add a stat card to ${pageTitle}`,
    `Add a data table to ${pageTitle}`,
    `Summarize recent changes to ${pageTitle}`,
  ];

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          aria-label="Open chat"
          className="absolute bottom-6 right-6 z-30 h-12 w-12 rounded-full bg-accent-500 text-on-accent shadow-floating flex items-center justify-center hover:bg-accent-600"
        >
          <MessageCircle className="h-5 w-5" />
        </button>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            key="drawer"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="absolute top-4 right-4 bottom-4 z-30 w-full max-w-[380px] rounded-xl bg-panel-dark panel-dark-border border shadow-floating flex flex-col overflow-hidden"
          >
            <div className="shrink-0 flex items-center justify-between gap-2 h-14 px-4 border-b panel-dark-border">
              <div className="flex items-center gap-2 min-w-0">
                <Sparkles className="h-4 w-4 text-accent-400 shrink-0" />
                <span className="text-[14px] font-semibold panel-dark-text-primary truncate">AI Assistant</span>
              </div>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                aria-label="Close chat"
                className="h-8 w-8 rounded-md flex items-center justify-center text-[var(--panel-dark-text-secondary)] hover:text-[var(--panel-dark-text-primary)] hover:bg-white/5 shrink-0"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <ChatPanel variant="split" surface="dark" suggestions={suggestions} onSelectSuggestion={chatPanelProps.onSend} {...chatPanelProps} />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
