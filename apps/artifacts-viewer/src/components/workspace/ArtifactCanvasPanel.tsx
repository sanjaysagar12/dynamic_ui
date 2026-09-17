'use client';

import { RotateCw } from 'lucide-react';
import { useArtifactSrc } from '../../hooks/useArtifactSrc';
import { ArtifactFrame } from '../ArtifactFrame';
import { Skeleton } from '../ui/skeleton';

export interface ArtifactCanvasPanelProps {
  title: string;
  urlPath: string;
  token: string;
  generating: boolean;
  reloadKey: number;
}

export function ArtifactCanvasPanel({ title, urlPath, token, generating, reloadKey }: ArtifactCanvasPanelProps) {
  const src = useArtifactSrc(urlPath, token);

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-app">
      <div className="flex-1 min-h-0 p-8 pt-0 overflow-auto">
        <div className="relative mx-auto h-full w-full rounded-lg border border-subtle shadow-card bg-white overflow-hidden">
          {src ? (
            <ArtifactFrame src={src} title={title} reloadNonce={reloadKey} />
          ) : (
            <div className="p-6 flex flex-col gap-3">
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-40 w-full" />
            </div>
          )}
          {generating && (
            <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px] flex items-center justify-center">
              <div className="bg-surface-raised border border-subtle rounded-full px-4 py-2 flex items-center gap-2 shadow-floating">
                <RotateCw className="h-3.5 w-3.5 animate-spin text-accent-400" />
                <span className="text-[13px] text-primary font-medium">Updating page…</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
