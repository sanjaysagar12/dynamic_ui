'use client';

import { useState } from 'react';
import type { Skill } from '../../lib/skills/types';
import { createSkill, updateSkill, deleteSkill, SkillRequestError } from '../../lib/api/skills-client';
import { theme, inputStyle, primaryButtonStyle, secondaryButtonStyle } from '../../lib/ui/theme';

export interface SkillsPanelProps {
  skills: Skill[];
  /** Re-fetches the skill list in the parent after a successful create/update/delete. */
  onChange: () => void;
}

type FormMode = { type: 'create' } | { type: 'edit'; name: string } | null;

export function SkillsPanel({ skills, onChange }: SkillsPanelProps) {
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const cancel = () => {
    setFormMode(null);
    setError(null);
  };

  const submit = async () => {
    if (!formMode) return;
    setPending(true);
    setError(null);

    try {
      if (formMode.type === 'create') {
        await createSkill({ name: name.trim(), description: description.trim(), content: content.trim() });
      } else {
        await updateSkill(formMode.name, { description: description.trim(), content: content.trim() });
      }
      setFormMode(null);
      onChange();
    } catch (err) {
      setError(err instanceof SkillRequestError ? err.message : 'Failed to save skill');
    } finally {
      setPending(false);
    }
  };

  const remove = async (skillName: string) => {
    if (!window.confirm(`Delete skill "${skillName}"? This can't be undone.`)) return;
    setError(null);

    try {
      await deleteSkill(skillName);
      onChange();
    } catch (err) {
      setError(err instanceof SkillRequestError ? err.message : 'Failed to delete skill');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span
          style={{
            fontSize: '0.75rem',
            fontWeight: 700,
            letterSpacing: '0.05em',
            color: theme.color.textMuted,
            textTransform: 'uppercase',
          }}
        >
          Skills
        </span>
        {!formMode && (
          <button
            type="button"
            onClick={startCreate}
            style={{ ...secondaryButtonStyle, fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}
          >
            + New
          </button>
        )}
      </div>

      {error && <span style={{ color: theme.color.danger, fontSize: '0.8rem' }}>{error}</span>}

      {!formMode && skills.length === 0 && (
        <span style={{ fontSize: '0.85rem', color: theme.color.textMuted }}>
          No skills yet — teach opencode a reusable procedure (e.g. a house style for forms).
        </span>
      )}

      {!formMode && skills.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {skills.map((skill) => (
            <li
              key={skill.name}
              style={{ padding: '0.4rem 0.5rem', borderRadius: theme.radiusSm, background: theme.color.bg }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                <strong style={{ fontSize: '0.85rem' }}>{skill.name}</strong>
                <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => startEdit(skill)}
                    style={{ border: 'none', background: 'none', color: theme.color.primary, cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(skill.name)}
                    style={{ border: 'none', background: 'none', color: theme.color.danger, cursor: 'pointer', fontSize: '0.8rem' }}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: theme.color.textMuted }}>{skill.description}</p>
            </li>
          ))}
        </ul>
      )}

      {formMode && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <input
            placeholder="name (kebab-case, e.g. crud-form-style)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={formMode.type === 'edit'}
            style={inputStyle}
          />
          <textarea
            placeholder={'Description — when should opencode use this? e.g. "USE WHEN building a form to create or edit a record."'}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
          />
          <textarea
            placeholder="Content — the actual instructions/procedure, as markdown"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: '0.8rem' }}
          />
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button
              type="button"
              onClick={submit}
              disabled={pending || !name.trim() || !description.trim() || !content.trim()}
              style={{ ...primaryButtonStyle, flex: 1 }}
            >
              {formMode.type === 'create' ? 'Create' : 'Save'}
            </button>
            <button type="button" onClick={cancel} disabled={pending} style={{ ...secondaryButtonStyle, flex: 1 }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
