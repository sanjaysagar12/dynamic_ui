import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

export const SKILL_FILENAME = 'SKILL.md';

const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// Mirrors Python's `\A---\s*\n(.*?)\n---\s*\n?(.*)\Z` with re.DOTALL: no
// multiline flag, so ^/$ anchor to the whole string, and [\s\S] stands in
// for DOTALL's ".".
const FRONTMATTER_PATTERN = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/;

export class InvalidSkillNameError extends Error {}
export class SkillNotFoundError extends Error {}
export class SkillAlreadyExistsError extends Error {}

export interface ParsedSkill {
  name: string;
  description: string;
  content: string;
}

export function validateSkillName(name: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw new InvalidSkillNameError(
      `Invalid skill name '${name}': must be lowercase kebab-case (letters, digits, hyphens only, ` +
        'no leading/trailing/double hyphens)',
    );
  }
}

function skillsDir(artifactsRoot: string): string {
  return join(artifactsRoot, '.opencode', 'skills');
}

function skillFile(artifactsRoot: string, name: string): string {
  return join(skillsDir(artifactsRoot), name, SKILL_FILENAME);
}

function serialize(name: string, description: string, content: string): string {
  // Matches the format this repo's own root .opencode/skills/*/SKILL.md
  // already uses — the same convention opencode discovers directly.
  const escapedDescription = description.replace(/"/g, '\\"');
  return `---\nname: ${name}\ndescription: "${escapedDescription}"\n---\n\n${content.trim()}\n`;
}

function parse(raw: string): ParsedSkill {
  const match = FRONTMATTER_PATTERN.exec(raw);
  if (!match) {
    throw new Error("Malformed SKILL.md: missing '---' frontmatter block");
  }
  const [, frontmatter, content] = match;

  let name = '';
  let description = '';
  for (const line of frontmatter.split('\n')) {
    if (line.startsWith('name:')) {
      name = line.slice('name:'.length).trim();
    } else if (line.startsWith('description:')) {
      let value = line.slice('description:'.length).trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1).replace(/\\"/g, '"');
      }
      description = value;
    }
  }

  return { name, description, content: content.trim() };
}

export function listSkills(artifactsRoot: string): ParsedSkill[] {
  const dir = skillsDir(artifactsRoot);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return [];
  }

  const results: ParsedSkill[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const file = join(dir, entry, SKILL_FILENAME);
    if (!existsSync(file) || !statSync(file).isFile()) {
      continue;
    }
    try {
      const parsed = parse(readFileSync(file, 'utf-8'));
      results.push({ ...parsed, name: parsed.name || entry });
    } catch {
      continue;
    }
  }
  return results;
}

export function readSkill(artifactsRoot: string, name: string): ParsedSkill | null {
  validateSkillName(name);
  const file = skillFile(artifactsRoot, name);
  if (!existsSync(file) || !statSync(file).isFile()) {
    return null;
  }
  const parsed = parse(readFileSync(file, 'utf-8'));
  return { ...parsed, name: parsed.name || name };
}

export function createSkill(artifactsRoot: string, name: string, description: string, content: string): ParsedSkill {
  validateSkillName(name);
  const file = skillFile(artifactsRoot, name);
  if (existsSync(file)) {
    throw new SkillAlreadyExistsError(`Skill '${name}' already exists`);
  }

  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, serialize(name, description, content), 'utf-8');
  return { name, description, content };
}

export function updateSkill(artifactsRoot: string, name: string, description: string, content: string): ParsedSkill {
  validateSkillName(name);
  const file = skillFile(artifactsRoot, name);
  if (!existsSync(file) || !statSync(file).isFile()) {
    throw new SkillNotFoundError(`Skill '${name}' not found`);
  }

  writeFileSync(file, serialize(name, description, content), 'utf-8');
  return { name, description, content };
}

export function deleteSkill(artifactsRoot: string, name: string): void {
  validateSkillName(name);
  const dir = dirname(skillFile(artifactsRoot, name));
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new SkillNotFoundError(`Skill '${name}' not found`);
  }

  rmSync(dir, { recursive: true, force: true });
}
