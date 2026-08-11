import type { CreateSkillPayload, ListSkillsResponsePayload, Skill, UpdateSkillPayload } from '../skills/types';

export class SkillRequestError extends Error {}

async function parseError(response: Response, fallback: string): Promise<never> {
  const body = await response.json().catch(() => ({}));
  throw new SkillRequestError(body.error || fallback);
}

export async function fetchSkills(): Promise<Skill[]> {
  const response = await fetch('/api/skills');
  if (!response.ok) await parseError(response, `Failed to load skills (status ${response.status})`);
  const data: ListSkillsResponsePayload = await response.json();
  return data.skills;
}

export async function createSkill(payload: CreateSkillPayload): Promise<Skill> {
  const response = await fetch('/api/skills', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) await parseError(response, `Failed to create skill (status ${response.status})`);
  return response.json();
}

export async function updateSkill(name: string, payload: UpdateSkillPayload): Promise<Skill> {
  const response = await fetch(`/api/skills/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) await parseError(response, `Failed to update skill (status ${response.status})`);
  return response.json();
}

export async function deleteSkill(name: string): Promise<void> {
  const response = await fetch(`/api/skills/${encodeURIComponent(name)}`, { method: 'DELETE' });
  if (!response.ok) await parseError(response, `Failed to delete skill (status ${response.status})`);
}
