'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useSession } from '../lib/session/session-context';
import { useToolCatalog } from './useToolCatalog';

const BRIDGE_SOURCE = 'artifact-data-bridge';

interface DataBridgeRequest {
  source: typeof BRIDGE_SOURCE;
  type: 'request';
  requestId: string;
  tool: string;
  args?: unknown;
  // Deliberately never read anywhere below. An artifact is untrusted,
  // potentially AI-generated code — whether a mutating call actually gets
  // confirmed is decided entirely by this platform's own
  // ConfirmMutationDialog (or the fact that none was required, for a
  // non-mutating tool), never by whatever value the artifact's own JS put
  // here. Kept in the type only so isDataBridgeRequest's shape check still
  // documents the full wire contract AGENTS.md describes to artifact authors.
  confirmed?: boolean;
}

function isDataBridgeRequest(data: unknown): data is DataBridgeRequest {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const candidate = data as Record<string, unknown>;
  return candidate.source === BRIDGE_SOURCE && candidate.type === 'request' && typeof candidate.requestId === 'string' && typeof candidate.tool === 'string';
}

export interface PendingMutationConfirmation {
  tool: string;
  args: unknown;
  destructive: boolean;
}

export interface ArtifactDataBridge {
  /** Non-null while a mutating call is waiting on the platform's own confirmation dialog. */
  pendingConfirmation: PendingMutationConfirmation | null;
  /** User clicked Confirm — lets the blocked request through. */
  confirmPending: () => void;
  /** User clicked Cancel (or dismissed the dialog) — the request never reaches tool-service. */
  cancelPending: () => void;
}

/**
 * Mediates tool-service data access for a sandboxed artifact over postMessage.
 *
 * Artifacts are untrusted, potentially AI-generated (and thus potentially
 * injected/malicious) content, so they never receive the session's access
 * token — they can't exfiltrate or misuse a credential they don't have. An
 * artifact instead posts `{ source: 'artifact-data-bridge', type: 'request', tool, args, confirmed }`
 * to `window.parent`; this hook validates the sender is really our iframe
 * (comparing `event.source`, since the sandboxed frame's `event.origin` is
 * the opaque string "null" and can't be matched normally), calls this app's
 * own `/api/tools/:name` route using the parent's own session, and posts the
 * tool's `{ok, data}` / `{ok: false, error, code}` result back unmodified —
 * see AGENTS.md's `callTool` helper for how the artifact unwraps it.
 *
 * Confirmation for a mutating call is enforced HERE, not trusted from the
 * artifact's message: real `mutates`/`destructive` metadata comes from
 * useToolCatalog (tool-service's own GET /tools), and an unresolved lookup
 * (catalog still loading, or an unknown tool name) fails CLOSED — treated
 * as requiring confirmation, never as safe to skip. The returned
 * `pendingConfirmation` state is meant to drive a ConfirmMutationDialog
 * mounted alongside the iframe (see ArtifactFrame.tsx); the fetch to
 * `/api/tools/:name` does not happen until `confirmPending()` resolves it.
 */
export function useArtifactDataBridge(iframeRef: RefObject<HTMLIFrameElement | null>): ArtifactDataBridge {
  const { session } = useSession();
  const { getToolMeta } = useToolCatalog();

  const [pendingConfirmation, setPendingConfirmation] = useState<PendingMutationConfirmation | null>(null);
  const resolveConfirmationRef = useRef<((confirmed: boolean) => void) | null>(null);

  const confirmPending = useCallback(() => {
    resolveConfirmationRef.current?.(true);
    resolveConfirmationRef.current = null;
    setPendingConfirmation(null);
  }, []);

  const cancelPending = useCallback(() => {
    resolveConfirmationRef.current?.(false);
    resolveConfirmationRef.current = null;
    setPendingConfirmation(null);
  }, []);

  useEffect(() => {
    function requestUserConfirmation(tool: string, args: unknown, destructive: boolean): Promise<boolean> {
      return new Promise((resolve) => {
        resolveConfirmationRef.current = resolve;
        setPendingConfirmation({ tool, args, destructive });
      });
    }

    function handleMessage(event: MessageEvent) {
      const frameWindow = iframeRef.current?.contentWindow;
      if (!frameWindow || event.source !== frameWindow || !isDataBridgeRequest(event.data)) {
        return;
      }

      const { requestId, tool, args } = event.data;
      void respond(frameWindow, requestId, tool, args);
    }

    async function respond(target: Window, requestId: string, tool: string, args: unknown) {
      if (!session) {
        target.postMessage(
          { source: BRIDGE_SOURCE, type: 'response', requestId, status: 401, body: { ok: false, error: 'Not logged in', code: 'UNAUTHENTICATED' } },
          '*',
        );
        return;
      }

      const meta = getToolMeta(tool);
      // Fail closed: catalog still loading, or `tool` isn't a real tool
      // name at all — either way, require confirmation. Only a positively
      // known mutates: false skips it.
      const requiresConfirmation = meta ? meta.mutates : true;

      if (requiresConfirmation) {
        const confirmed = await requestUserConfirmation(tool, args, meta?.destructive ?? true);
        if (!confirmed) {
          target.postMessage(
            { source: BRIDGE_SOURCE, type: 'response', requestId, status: 200, body: { ok: false, error: 'Cancelled by user', code: 'USER_CANCELLED' } },
            '*',
          );
          return;
        }
      }

      try {
        const response = await fetch(`/api/tools/${encodeURIComponent(tool)}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
            'Content-Type': 'application/json',
          },
          // The artifact's own `confirmed` claim is never forwarded — only
          // this platform's own confirmation outcome (or the fact that
          // none was required) decides this value.
          body: JSON.stringify({ args, confirmed: requiresConfirmation ? true : undefined }),
        });
        const text = await response.text();
        target.postMessage(
          { source: BRIDGE_SOURCE, type: 'response', requestId, status: response.status, body: text ? JSON.parse(text) : null },
          '*',
        );
      } catch {
        target.postMessage(
          { source: BRIDGE_SOURCE, type: 'response', requestId, status: 502, body: { ok: false, error: 'Failed to reach the tool layer', code: 'BRIDGE_UNREACHABLE' } },
          '*',
        );
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [iframeRef, session, getToolMeta]);

  return { pendingConfirmation, confirmPending, cancelPending };
}
