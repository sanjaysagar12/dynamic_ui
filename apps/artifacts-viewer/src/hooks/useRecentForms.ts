'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PostWriteOfferPayload } from '../lib/db-chat/types';

const MAX_RECENT_FORMS = 4;

function storageKey(email: string): string {
  return `dynamic-ui:recent-forms:${email}`;
}

function loadFromStorage(email: string): PostWriteOfferPayload[] {
  try {
    const raw = window.localStorage.getItem(storageKey(email));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as PostWriteOfferPayload[]) : [];
  } catch {
    return [];
  }
}

export interface UseRecentFormsResult {
  /** Most-recently-opened forms first, deduped by toolName — reuses PostWriteOfferPayload's own
   *  shape (label/toolName/form/prefill) since opening one is exactly the same action as clicking
   *  a post-write hook's offer chip: open that form_request directly, no message sent to the agent. */
  recentForms: PostWriteOfferPayload[];
  /** Call whenever a form is actually opened (a fresh form_request from chat, or a selected offer)
   *  — moves it to the front if already present, otherwise inserts it, capped at MAX_RECENT_FORMS. */
  recordFormOpened: (entry: PostWriteOfferPayload) => void;
}

/**
 * Per-viewer convenience state only, kept in localStorage — never sent to the server and never
 * read back by the agent. Scoped by email so one person's recent forms don't bleed into another
 * account on a shared browser. Losing it (private window, cleared site data, storage disabled)
 * just means the assistant page falls back to its static suggestion prompts; nothing breaks.
 */
export function useRecentForms(email: string | undefined): UseRecentFormsResult {
  const [recentForms, setRecentForms] = useState<PostWriteOfferPayload[]>([]);

  useEffect(() => {
    setRecentForms(email ? loadFromStorage(email) : []);
  }, [email]);

  const recordFormOpened = useCallback(
    (entry: PostWriteOfferPayload) => {
      if (!email) return;
      setRecentForms((current) => {
        const next = [entry, ...current.filter((f) => f.toolName !== entry.toolName)].slice(0, MAX_RECENT_FORMS);
        try {
          window.localStorage.setItem(storageKey(email), JSON.stringify(next));
        } catch {
          // Storage can throw (private window, quota, disabled) — the in-memory list above still
          // updates for this page view, it just won't survive a reload.
        }
        return next;
      });
    },
    [email],
  );

  return { recentForms, recordFormOpened };
}
