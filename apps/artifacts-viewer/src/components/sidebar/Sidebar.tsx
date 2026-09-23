'use client';

import { Sparkles } from 'lucide-react';
import { useSession } from '../../lib/session/session-context';
import { useArtifactCatalog } from '../../hooks/useArtifactCatalog';
import { useRenameArtifactMutation, useDeleteArtifactMutation } from '../../lib/queries/artifacts';
import { Skeleton } from '../ui/skeleton';
import { ArtifactListItem } from './ArtifactListItem';
import { cn } from '../../lib/utils/cn';

export interface SidebarProps {
  activeArtifactSlug: string | null;
  isAssistantActive: boolean;
  onSelectArtifact: (slug: string) => void;
  onSelectAssistant: () => void;
}

export function Sidebar({ activeArtifactSlug, isAssistantActive, onSelectArtifact, onSelectAssistant }: SidebarProps) {
  const { session } = useSession();
  const token = session?.accessToken ?? null;
  const { artifacts, loading } = useArtifactCatalog(token);
  const renameMutation = useRenameArtifactMutation(token);
  const deleteMutation = useDeleteArtifactMutation(token);

  const handleDelete = (slug: string) => {
    deleteMutation.mutate(slug);
    if (slug === activeArtifactSlug) onSelectAssistant();
  };

  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col bg-sidebar sidebar-border border-r">
      <div className="flex items-center gap-2.5 h-16 px-4 shrink-0">
        <div className="h-8 w-8 rounded-lg bg-white flex items-center justify-center shrink-0">
          <Sparkles className="h-4 w-4 text-accent-500" />
        </div>
        <div className="min-w-0">
          <div className="text-[14px] font-semibold sidebar-text-primary leading-tight truncate">Dynamic UI</div>
          <div className="text-[10px] font-semibold tracking-wide sidebar-text-secondary uppercase truncate">
            AI Inventory System
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 pt-2">
        {loading && (
          <div className="flex flex-col gap-2 px-1">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        )}

        {!loading && artifacts.length > 0 && (
          <div className="mb-2">
            <div className="text-micro sidebar-text-secondary px-2.5 pt-2 pb-1">WORKSPACE</div>
            <div className="flex flex-col gap-0.5">
              {artifacts.map((artifact) => (
                <ArtifactListItem
                  key={artifact.slug}
                  artifact={artifact}
                  active={!isAssistantActive && artifact.slug === activeArtifactSlug}
                  onSelect={() => onSelectArtifact(artifact.slug)}
                  onRename={(title) => renameMutation.mutate({ slug: artifact.slug, title })}
                  onDelete={() => handleDelete(artifact.slug)}
                />
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="text-micro sidebar-text-secondary px-2.5 pt-2 pb-1">INTELLIGENCE</div>
          <button
            type="button"
            onClick={onSelectAssistant}
            className={cn(
              'w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left',
              isAssistantActive ? 'bg-sidebar-active' : 'sidebar-hover-bg',
            )}
          >
            <div className="h-8 w-8 rounded-md bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
              <Sparkles className="h-4 w-4 sidebar-text-secondary" />
            </div>
            <span className="text-[13px] font-medium sidebar-text-primary">AI Assistant</span>
          </button>
        </div>
      </div>

      <div className="shrink-0 px-4 py-3 border-t sidebar-border flex items-center gap-2.5">
        <div className="h-8 w-8 rounded-full bg-white/10 flex items-center justify-center text-[13px] font-semibold sidebar-text-primary shrink-0">
          D
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-medium sidebar-text-primary truncate">Dynamic UI</div>
          <div className="text-[11px] sidebar-text-secondary truncate">Workspace · v1.0</div>
        </div>
      </div>
    </aside>
  );
}
