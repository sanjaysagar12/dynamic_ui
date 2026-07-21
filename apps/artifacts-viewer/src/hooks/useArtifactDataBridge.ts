'use client';

import { useEffect } from 'react';
import type { RefObject } from 'react';
import { useSupabaseSession } from '../lib/supabase/supabase-session-context';

const BRIDGE_SOURCE = 'artifact-data-bridge';

interface DataBridgeRequest {
  source: typeof BRIDGE_SOURCE;
  type: 'request';
  requestId: string;
  table: string;
  method: string;
  id?: string;
  body?: unknown;
  search?: string;
}

function isDataBridgeRequest(data: unknown): data is DataBridgeRequest {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const candidate = data as Record<string, unknown>;
  return (
    candidate.source === BRIDGE_SOURCE &&
    candidate.type === 'request' &&
    typeof candidate.requestId === 'string' &&
    typeof candidate.table === 'string' &&
    typeof candidate.method === 'string'
  );
}

/**
 * Mediates Supabase data access for a sandboxed artifact over postMessage.
 *
 * Artifacts are untrusted, potentially AI-generated (and thus potentially
 * injected/malicious) content, so they never receive the Supabase access
 * token — they can't exfiltrate or misuse a credential they don't have. An
 * artifact instead posts `{ source: 'artifact-data-bridge', type: 'request', ... }`
 * to `window.parent`; this hook validates the sender is really our iframe
 * (comparing `event.source`, since the sandboxed frame's `event.origin` is
 * the opaque string "null" and can't be matched normally), performs the
 * request itself using the parent's own session, and posts the result back.
 * Row-level security in Postgres — not this bridge — is what actually scopes
 * the data a given user can see or change.
 */
export function useArtifactDataBridge(iframeRef: RefObject<HTMLIFrameElement | null>): void {
  const { session } = useSupabaseSession();

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const frameWindow = iframeRef.current?.contentWindow;
      if (!frameWindow || event.source !== frameWindow || !isDataBridgeRequest(event.data)) {
        return;
      }

      const { requestId, table, method, id, body, search } = event.data;
      void respond(frameWindow, requestId, table, method, id, body, search);
    }

    async function respond(
      target: Window,
      requestId: string,
      table: string,
      method: string,
      id: string | undefined,
      body: unknown,
      search: string | undefined,
    ) {
      if (!session) {
        target.postMessage(
          { source: BRIDGE_SOURCE, type: 'response', requestId, status: 401, body: { error: 'Not logged in to Supabase' } },
          '*',
        );
        return;
      }

      try {
        const path = `/api/data/${encodeURIComponent(table)}${id ? `/${encodeURIComponent(id)}` : ''}${search ? `?${search}` : ''}`;
        const response = await fetch(path, {
          method,
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
            'X-User-Id': session.userId,
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        const text = await response.text();
        target.postMessage(
          { source: BRIDGE_SOURCE, type: 'response', requestId, status: response.status, body: text ? JSON.parse(text) : null },
          '*',
        );
      } catch {
        target.postMessage(
          { source: BRIDGE_SOURCE, type: 'response', requestId, status: 502, body: { error: 'Failed to reach the data layer' } },
          '*',
        );
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [iframeRef, session]);
}
