import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type {
  DiscoveredProject,
  EnvFile,
  EnvVarEntry,
  ProjectEnv,
  Warning,
} from './types.js';

const ENV_FILE_PATTERN = /^\.env(\..+)?$/;

export function discoverEnvFiles(
  workspaceRoot: string,
  projects: DiscoveredProject[]
): { projectEnvs: ProjectEnv[]; warnings: Warning[] } {
  const warnings: Warning[] = [];
  const projectEnvs: ProjectEnv[] = [];

  for (const project of projects) {
    if (!project.root) continue;
    const absRoot = join(workspaceRoot, project.root);

    let entries: string[];
    try {
      entries = readdirSync(absRoot);
    } catch (err) {
      warnings.push({
        scope: project.name,
        message: `Could not read project directory: ${(err as Error).message}`,
      });
      continue;
    }

    const envFileNames = entries.filter((name) => ENV_FILE_PATTERN.test(name));
    if (envFileNames.length === 0) continue;

    const files: EnvFile[] = [];
    for (const fileName of envFileNames) {
      const absPath = join(absRoot, fileName);
      try {
        const vars = parseEnvFile(readFileSync(absPath, 'utf8'));
        files.push({
          path: absPath,
          relativePath: relative(workspaceRoot, absPath),
          vars,
        });
      } catch (err) {
        warnings.push({
          scope: `${project.name}/${fileName}`,
          message: `Could not parse env file: ${(err as Error).message}`,
        });
      }
    }

    if (files.length > 0) {
      projectEnvs.push({ project: project.name, root: project.root, files });
    }
  }

  return { projectEnvs, warnings };
}

/** Minimal, dependency-free .env parser that tracks the source line of each key. */
export function parseEnvFile(contents: string): EnvVarEntry[] {
  const vars: EnvVarEntry[] = [];
  const lines = contents.split(/\r?\n/);

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const match = /^([\w.-]+)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) return;

    const key = match[1];
    let value = match[2];

    const isDoubleQuoted = value.startsWith('"') && value.endsWith('"');
    const isSingleQuoted = value.startsWith("'") && value.endsWith("'");
    if ((isDoubleQuoted || isSingleQuoted) && value.length >= 2) {
      value = value.slice(1, -1);
    }

    vars.push({ key, value, line: index });
  });

  return vars;
}
