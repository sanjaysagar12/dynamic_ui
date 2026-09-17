'use client';

import { useState } from 'react';
import { Plus, Pencil, Trash2, BookOpen } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input, Textarea } from '../ui/input';
import { Badge } from '../ui/badge';
import {
  useSkillsQuery,
  useCreateSkillMutation,
  useUpdateSkillMutation,
  useDeleteSkillMutation,
} from '../../lib/queries/skills';
import type { Skill } from '../../lib/skills/types';

export interface SkillsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: string[];
  onSelectedChange: (names: string[]) => void;
}

type FormMode = { type: 'create' } | { type: 'edit'; name: string } | null;

export function SkillsDialog({ open, onOpenChange, selected, onSelectedChange }: SkillsDialogProps) {
  const { data: skills = [] } = useSkillsQuery();
  const createMutation = useCreateSkillMutation();
  const updateMutation = useUpdateSkillMutation();
  const deleteMutation = useDeleteSkillMutation();

  const [formMode, setFormMode] = useState<FormMode>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);

  const toggle = (skillName: string) => {
    onSelectedChange(selected.includes(skillName) ? selected.filter((n) => n !== skillName) : [...selected, skillName]);
  };

  const startCreate = () => {
    setFormMode({ type: 'create' });
    setName('');
    setDescription('');
    setContent('');
    setError(null);
  };

  const startEdit = (skill: Skill) => {
    setFormMode({ type: 'edit', name: skill.name });
    setName(skill.name);
    setDescription(skill.description);
    setContent(skill.content);
    setError(null);
  };

  const submit = async () => {
    setError(null);
    try {
      if (formMode?.type === 'create') {
        await createMutation.mutateAsync({ name: name.trim(), description: description.trim(), content: content.trim() });
      } else if (formMode?.type === 'edit') {
        await updateMutation.mutateAsync({ name: formMode.name, payload: { description: description.trim(), content: content.trim() } });
      }
      setFormMode(null);
    } catch {
      setError('Failed to save skill');
    }
  };

  const remove = async (skillName: string) => {
    if (!window.confirm(`Delete skill "${skillName}"? This can't be undone.`)) return;
    onSelectedChange(selected.filter((n) => n !== skillName));
    await deleteMutation.mutateAsync(skillName).catch(() => setError('Failed to delete skill'));
  };

  const pending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Skills" className="max-w-lg max-h-[80vh] overflow-y-auto">
        <p className="text-[13px] text-secondary -mt-2 mb-4">
          Reusable procedures the page-building assistant can follow. Select one to apply it to your next message.
        </p>

        {!formMode && (
          <>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {skills.map((skill) => (
                <button key={skill.name} type="button" onClick={() => toggle(skill.name)} title={skill.description}>
                  <Badge variant={selected.includes(skill.name) ? 'accent' : 'neutral'}>{skill.name}</Badge>
                </button>
              ))}
              {skills.length === 0 && <span className="text-[13px] text-tertiary">No skills yet.</span>}
            </div>

            <div className="flex items-center justify-between mb-2">
              <span className="text-micro text-tertiary">MANAGE</span>
              <Button variant="ghost" size="icon-sm" onClick={startCreate} aria-label="New skill">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-col gap-1.5">
              {skills.map((skill) => (
                <div key={skill.name} className="flex items-center justify-between gap-2 rounded-md bg-surface-raised px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-primary flex items-center gap-1.5">
                      <BookOpen className="h-3.5 w-3.5 text-tertiary" /> {skill.name}
                    </div>
                    <div className="text-[12px] text-tertiary truncate">{skill.description}</div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="icon-sm" onClick={() => startEdit(skill)} aria-label="Edit skill">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => remove(skill.name)} aria-label="Delete skill">
                      <Trash2 className="h-3.5 w-3.5 text-negative" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {formMode && (
          <div className="flex flex-col gap-3">
            <Input
              placeholder="name (kebab-case, e.g. crud-form-style)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={formMode.type === 'edit'}
            />
            <Textarea
              placeholder='Description — when should this be used? e.g. "USE WHEN building a form to create or edit a record."'
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
            <Textarea
              placeholder="Content — the actual instructions/procedure, as markdown"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={8}
              className="font-mono text-[12px]"
            />
            {error && <p className="text-negative text-[12px]">{error}</p>}
            <DialogFooter className="mt-0">
              <Button variant="outlined" size="compact" onClick={() => setFormMode(null)}>
                Cancel
              </Button>
              <Button
                size="compact"
                loading={pending}
                disabled={!name.trim() || !description.trim() || !content.trim()}
                onClick={submit}
              >
                {formMode.type === 'create' ? 'Create' : 'Save'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
