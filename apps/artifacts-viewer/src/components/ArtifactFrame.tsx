'use client';

import { useRef } from 'react';
import { useArtifactDataBridge } from '../hooks/useArtifactDataBridge';

/**
 * Artifacts are untrusted content (arbitrary HTML/JS from the artifacts server,
 * often AI-generated) and must be strongly isolated from the parent app:
 *  - sandbox omits "allow-same-origin", so the framed document gets a unique
 *    opaque origin and cannot read this app's cookies, storage, or DOM.
 *  - "allow-scripts" is the only permission granted, since artifacts ship
 *    interactive JS; nothing else (forms, popups, top navigation, downloads,
 *    modals, pointer lock, ...) is enabled.
 *  - no `allow` (Permissions Policy) features are delegated.
 *  - referrerPolicy is "no-referrer" so this app's URL is never sent to the
 *    artifacts server as a Referer header.
 *  - the artifact is never given a Supabase (or any other) credential — see
 *    useArtifactDataBridge — since injected/malicious artifact code could
 *    exfiltrate a token it can read. Data access goes through postMessage,
 *    mediated by this component using the parent's own session.
 */
export interface ArtifactFrameProps {
  src: string;
  title: string;
  /** Bump this (e.g. a counter) to force the iframe to remount and reload
   *  even when `src` itself hasn't changed — the artifact's underlying files
   *  can change (a new chat turn, a manual refresh) without its URL doing so. */
  reloadNonce?: number | string;
}

export function ArtifactFrame({ src, title, reloadNonce }: ArtifactFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  useArtifactDataBridge(iframeRef);

  return (
    <iframe
      ref={iframeRef}
      key={`${src}:${reloadNonce ?? ''}`}
      src={src}
      title={title}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      style={{ width: '100%', height: '100%', border: 'none' }}
    />
  );
}
