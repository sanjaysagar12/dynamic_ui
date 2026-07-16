'use client';

/**
 * Artifacts are untrusted content (arbitrary HTML/JS from the artifacts server)
 * and must be strongly isolated from the parent app:
 *  - sandbox omits "allow-same-origin", so the framed document gets a unique
 *    opaque origin and cannot read this app's cookies, storage, or DOM.
 *  - "allow-scripts" is the only permission granted, since artifacts ship
 *    interactive JS; nothing else (forms, popups, top navigation, downloads,
 *    modals, pointer lock, ...) is enabled.
 *  - no `allow` (Permissions Policy) features are delegated.
 *  - referrerPolicy is "no-referrer" so this app's URL is never sent to the
 *    artifacts server as a Referer header.
 */
export interface ArtifactFrameProps {
  src: string;
  title: string;
}

export function ArtifactFrame({ src, title }: ArtifactFrameProps) {
  return (
    <iframe
      key={src}
      src={src}
      title={title}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      style={{ width: '100%', height: '100%', border: 'none' }}
    />
  );
}
