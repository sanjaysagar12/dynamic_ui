'use client';

import { useState, useRef, useEffect } from 'react';
import { FileText, MoreHorizontal, Pencil, Trash2, Wand2 } from 'lucide-react';
import type { ArtifactCatalogEntry } from '../../lib/artifacts/types';
import { cn } from '../../lib/utils/cn';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '../ui/dropdown-menu';
import { Dialog, DialogContent, DialogFooter, DialogDescription } from '../ui/dialog';
import { Button } from '../ui/button';
import { Textarea } from '../ui/input';

export interface ArtifactListItemProps {
  artifact: ArtifactCatalogEntry;
  active: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  // Edits this artifact's content via opencode, driven by a free-text prompt — distinct from
  // onRename (metadata only). Resolves with the agent's own confirmation text on success, or
  // throws with a message to show inline.
  onEdit: (prompt: string) => Promise<string>;
}

export function ArtifactListItem({ artifact, active, onSelect, onRename, onDelete, onEdit }: ArtifactListItemProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(artifact.title ?? '');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editPrompt, setEditPrompt] = useState('');
  const [editPending, setEditPending] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editReply, setEditReply] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const openEditDialog = () => {
    setEditPrompt('');
    setEditError(null);
    setEditReply(null);
    setEditOpen(true);
  };

  const submitEdit = async () => {
    const prompt = editPrompt.trim();
    if (!prompt || editPending) return;
    setEditPending(true);
    setEditError(null);
    try {
      const reply = await onEdit(prompt);
      setEditReply(reply);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Could not edit this page — try again.');
    } finally {
      setEditPending(false);
    }
  };

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commitRename = () => {
    const trimmed = title.trim();
    setEditing(false);
    if (trimmed && trimmed !== artifact.title) onRename(trimmed);
    else setTitle(artifact.title ?? '');
  };

  if (editing) {
    return (
      <div className="px-1 py-0.5">
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') {
              setTitle(artifact.title ?? '');
              setEditing(false);
            }
          }}
          onBlur={commitRename}
          className="w-full h-9 rounded-md bg-white/10 border border-white/10 sidebar-text-primary text-[13px] px-2.5 outline-none focus-visible:border-white/30"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 cursor-pointer',
        active ? 'bg-sidebar-active' : 'sidebar-hover-bg',
      )}
      onClick={onSelect}
    >
      <div className="h-8 w-8 rounded-md bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
        <FileText className="h-4 w-4 sidebar-text-secondary" />
      </div>
      <div className="min-w-0 flex-1">
        <div className={cn('text-[13px] truncate', active ? 'sidebar-text-primary font-semibold' : 'sidebar-text-primary font-medium')}>
          {artifact.title || artifact.slug}
        </div>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            onClick={(e) => e.stopPropagation()}
            className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 sidebar-text-secondary hover:!text-white p-1 rounded-md shrink-0"
            aria-label="Page actions"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onSelect={openEditDialog}>
            <Wand2 className="h-3.5 w-3.5" /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem destructive onSelect={() => setConfirmOpen(true)}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          if (editPending) return; // don't let an in-flight edit get dismissed and lost
          setEditOpen(open);
        }}
      >
        <DialogContent title={`Edit “${artifact.title || artifact.slug}”`} onClick={(e) => e.stopPropagation()}>
          {editReply ? (
            <>
              <DialogDescription className="text-secondary text-[13px] whitespace-pre-wrap">{editReply}</DialogDescription>
              <DialogFooter>
                <Button
                  size="compact"
                  onClick={() => {
                    setEditOpen(false);
                    // Jump to the result either way: if it was already open this forces a fresh
                    // reload (same slug, but WorkspaceShell bumps its preview reload key), and if
                    // it wasn't, the user gets taken straight to what they just asked to change.
                    onSelect();
                  }}
                >
                  Done
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogDescription className="text-secondary text-[13px] mb-3">
                Describe what to change. This edits the page in place — the same as continuing the chat on it.
              </DialogDescription>
              <Textarea
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                placeholder="e.g. Add a stat card showing total stock value"
                rows={3}
                disabled={editPending}
                autoFocus
              />
              {editError && <p className="text-negative text-[12px] mt-2">{editError}</p>}
              <DialogFooter>
                <Button variant="outlined" size="compact" onClick={() => setEditOpen(false)} disabled={editPending}>
                  Cancel
                </Button>
                <Button size="compact" loading={editPending} disabled={!editPrompt.trim()} onClick={submitEdit}>
                  Save changes
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent title="Delete this page?" onClick={(e) => e.stopPropagation()}>
          <DialogDescription className="text-secondary text-[13px]">
            “{artifact.title || artifact.slug}” will be permanently deleted. This can't be undone.
          </DialogDescription>
          <DialogFooter>
            <Button variant="outlined" size="compact" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="compact"
              onClick={() => {
                setConfirmOpen(false);
                onDelete();
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
