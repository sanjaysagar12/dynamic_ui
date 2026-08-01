import { existsSync } from 'fs';
import { join } from 'path';

const SLUG_STRIP_PATTERN = /[^a-z0-9]+/g;
const MAX_SLUG_LENGTH = 40;

function stripHyphens(value: string): string {
  return value.replace(/^-+/, '').replace(/-+$/, '');
}

export function slugify(text: string): string {
  const slug = stripHyphens(text.toLowerCase().replace(SLUG_STRIP_PATTERN, '-')).slice(0, MAX_SLUG_LENGTH);
  return stripHyphens(slug) || 'artifact';
}

export function uniqueSlug(base: string, artifactsRoot: string): string {
  if (!existsSync(join(artifactsRoot, base))) {
    return base;
  }

  let suffix = 2;
  while (existsSync(join(artifactsRoot, `${base}-${suffix}`))) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

// Ports Python's str.title(): each maximal run of alphabetic characters is
// capitalized at its start and lowercased after, with any other character
// resetting the run (so "3d printer" -> "3D Printer", not "3D printer").
export function titleFromSlug(slug: string): string {
  const text = slug.replace(/-/g, ' ').replace(/\//g, ' / ');
  let result = '';
  let prevIsAlpha = false;
  for (const ch of text) {
    if (/[A-Za-z]/.test(ch)) {
      result += prevIsAlpha ? ch.toLowerCase() : ch.toUpperCase();
      prevIsAlpha = true;
    } else {
      result += ch;
      prevIsAlpha = false;
    }
  }
  return result;
}
