'use client';

import { AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { cn } from '../lib/utils/cn';
import type { PendingMutationConfirmation } from '../hooks/useArtifactDataBridge';

export interface ConfirmMutationDialogProps {
  pending: PendingMutationConfirmation | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** `create_material` → "Create material" — good enough without a per-tool copy table. */
function humanizeToolName(tool: string): string {
  const words = tool.split('_').filter(Boolean);
  if (words.length === 0) return tool;
  return [words[0].charAt(0).toUpperCase() + words[0].slice(1), ...words.slice(1)].join(' ');
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** Flat key: value rows for a plain object's own args; a JSON block is the fallback for
 *  anything else (an array, a primitive, or just not worth a bespoke per-shape renderer here). */
function ArgsPreview({ args }: { args: unknown }) {
  const isPlainObject = typeof args === 'object' && args !== null && !Array.isArray(args);

  if (!isPlainObject) {
    return (
      <pre className="text-[12px] font-mono text-secondary bg-surface-raised border border-subtle rounded-md p-3 whitespace-pre-wrap break-words max-h-48 overflow-auto">
        {JSON.stringify(args, null, 2)}
      </pre>
    );
  }

  const entries = Object.entries(args as Record<string, unknown>);
  if (entries.length === 0) {
    return <p className="text-[13px] text-tertiary">No arguments.</p>;
  }

  return (
    <dl className="flex flex-col gap-1.5 text-[13px]">
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-baseline justify-between gap-4 border-b border-subtle pb-1.5 last:border-none last:pb-0">
          <dt className="text-tertiary shrink-0">{key}</dt>
          <dd className="text-primary text-right break-words">{formatValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The platform's own confirmation UI for any tool call an artifact's iframe
 * requests through the data bridge where tool-service's real catalog
 * metadata reports `mutates`. Driven entirely by useArtifactDataBridge.ts's
 * `pendingConfirmation` state — an artifact's own generated JS never
 * decides whether this appears, and the request it's blocking does not
 * reach tool-service until `onConfirm` fires.
 */
export function ConfirmMutationDialog({ pending, onConfirm, onCancel }: ConfirmMutationDialogProps) {
  const destructive = pending?.destructive ?? false;

  return (
    <Dialog open={pending !== null} onOpenChange={(open) => { if (!open) onCancel(); }}>
      {pending && (
        <DialogContent
          title={humanizeToolName(pending.tool)}
          className={cn(destructive && 'border-negative')}
        >
          {destructive && (
            <div className="flex items-start gap-2 bg-negative-soft border border-negative rounded-md p-3 mb-4">
              <AlertTriangle className="h-4 w-4 text-negative shrink-0 mt-0.5" />
              <p className="text-[13px] text-negative font-medium">
                This cannot be undone. Review the details below carefully before confirming.
              </p>
            </div>
          )}

          <p className="text-[13px] text-secondary mb-3">
            This page wants to make the following change:
          </p>

          <ArgsPreview args={pending.args} />

          <DialogFooter>
            <Button variant="outlined" size="compact" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant={destructive ? 'danger' : 'primary'} size="compact" onClick={onConfirm}>
              {destructive ? 'Yes, do this' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
