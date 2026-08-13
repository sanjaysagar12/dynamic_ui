import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Rewrites a single `KEY=value` line in place, preserving every other line
 * (comments, blank lines, ordering) exactly as-is. Appends the key at the end
 * of the file if it isn't already present.
 */
export function updateEnvValue(filePath: string, key: string, newValue: string): void {
  const original = readFileSync(filePath, 'utf8');
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const lines = original.split(/\r?\n/);

  const keyPattern = new RegExp(`^(\\s*)${escapeRegExp(key)}(\\s*=\\s*)(.*)$`);
  let found = false;

  const updated = lines.map((line) => {
    if (found) return line;
    if (line.trimStart().startsWith('#')) return line;
    const match = keyPattern.exec(line);
    if (!match) return line;
    found = true;
    const [, indent, separator] = match;
    return `${indent}${key}${separator}${formatValue(newValue)}`;
  });

  if (!found) {
    updated.push(`${key}=${formatValue(newValue)}`);
  }

  writeFileSync(filePath, updated.join(eol));
}

export function bulkUpdateEnvValue(
  filePaths: string[],
  key: string,
  newValue: string
): void {
  for (const filePath of filePaths) {
    updateEnvValue(filePath, key, newValue);
  }
}

function formatValue(value: string): string {
  if (/\s|#/.test(value) && !/^".*"$/.test(value)) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
