'use client';

import { LayoutTemplate, ArrowRight } from 'lucide-react';

export interface ArtifactReferenceChipProps {
  title: string;
  onClick: () => void;
}

export function ArtifactReferenceChip({ title, onClick }: ArtifactReferenceChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 flex items-center gap-2.5 w-full max-w-[320px] rounded-md border border-subtle bg-surface-raised px-3 py-2.5 text-left hover:bg-surface-hover"
    >
      <div className="h-8 w-8 rounded-md bg-accent-soft flex items-center justify-center shrink-0">
        <LayoutTemplate className="h-4 w-4 text-accent-400" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-primary truncate">{title}</div>
        <div className="text-[11px] text-tertiary flex items-center gap-1">
          Opened in canvas <ArrowRight className="h-3 w-3" />
        </div>
      </div>
    </button>
  );
}
