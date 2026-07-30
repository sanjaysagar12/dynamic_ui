'use client';

import type { Skill } from '../../lib/skills/types';
import { theme } from '../../lib/ui/theme';

export interface SkillSelectorProps {
  skills: Skill[];
  selected: string[];
  onChange: (names: string[]) => void;
}

/** Lets the user explicitly attach one or more skills to the next chat
 *  message(s) — selections stay active across turns until toggled off.
 *  opencode can also pick a skill up on its own from the request text alone
 *  (it matches the prompt against each skill's description), but naming
 *  skills explicitly here is more reliable than hoping the wording matches. */
export function SkillSelector({ skills, selected, onChange }: SkillSelectorProps) {
  if (skills.length === 0) return null;

  const toggle = (name: string) => {
    onChange(selected.includes(name) ? selected.filter((s) => s !== name) : [...selected, name]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      <span style={{ fontSize: '0.8rem', color: theme.color.textMuted }}>
        Skills{selected.length > 0 ? ` (${selected.length} selected)` : ''}
      </span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
        {skills.map((skill) => {
          const active = selected.includes(skill.name);
          return (
            <button
              key={skill.name}
              type="button"
              onClick={() => toggle(skill.name)}
              title={skill.description}
              aria-pressed={active}
              style={{
                padding: '0.3rem 0.65rem',
                borderRadius: '999px',
                border: `1px solid ${active ? theme.color.primary : theme.color.border}`,
                background: active ? theme.color.primarySoft : theme.color.surface,
                color: active ? theme.color.primary : theme.color.text,
                fontSize: '0.78rem',
                fontWeight: active ? 600 : 400,
                cursor: 'pointer',
              }}
            >
              {skill.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
