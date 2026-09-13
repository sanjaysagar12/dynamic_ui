'use client';

import { useEffect } from 'react';
import type { RefObject } from 'react';
import { useSession } from '../lib/session/session-context';

const BRIDGE_SOURCE = 'artifact-data-bridge';

interface DataBridgeRequest {
  source: typeof BRIDGE_SOURCE;
  type: 'request';
  requestId: string;
  tool: string;
  args?: unknown;
  confirmed?: boolean;
}

function isDataBridgeRequest(data: unknown): data is DataBridgeRequest {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const candidate = data as Record<string, unknown>;
  return candidate.source === BRIDGE_SOURCE && candidate.type === 'request' && typeof candidate.requestId === 'string' && typeof candidate.tool === 'string';
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
 */
export function useArtifactDataBridge(iframeRef: RefObject<HTMLIFrameElement | null>): void {
  const { session } = useSession();

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const frameWindow = iframeRef.current?.contentWindow;
      if (!frameWindow || event.source !== frameWindow || !isDataBridgeRequest(event.data)) {
        return;
      }

      const { requestId, tool, args, confirmed } = event.data;
      void respond(frameWindow, requestId, tool, args, confirmed);
    }

    async function respond(target: Window, requestId: string, tool: string, args: unknown, confirmed: boolean | undefined) {
      if (!session) {
        target.postMessage(
          { source: BRIDGE_SOURCE, type: 'response', requestId, status: 401, body: { ok: false, error: 'Not logged in', code: 'UNAUTHENTICATED' } },
          '*',
        );
        return;
      }

      try {
        const response = await fetch(`/api/tools/${encodeURIComponent(tool)}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ args, confirmed }),
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
  }, [iframeRef, session]);
}
