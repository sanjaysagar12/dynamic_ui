import type { ProjectEnv } from '../discovery/types.js';

export interface SharedKeyOccurrence {
  project: string;
  file: string;
  value: string;
}

export interface SharedKeyEntry {
  key: string;
  occurrences: SharedKeyOccurrence[];
  /** True when every occurrence of this key has the same value. */
  valuesMatch: boolean;
}

export function computeSharedKeys(projectEnvs: ProjectEnv[]): SharedKeyEntry[] {
  const byKey = new Map<string, SharedKeyOccurrence[]>();

  for (const projectEnv of projectEnvs) {
    for (const file of projectEnv.files) {
      for (const entry of file.vars) {
        const occurrences = byKey.get(entry.key) ?? [];
        occurrences.push({
          project: projectEnv.project,
          file: file.relativePath,
          value: entry.value,
        });
        byKey.set(entry.key, occurrences);
      }
    }
  }

  const shared: SharedKeyEntry[] = [];
  for (const [key, occurrences] of byKey) {
    const distinctProjects = new Set(occurrences.map((o) => o.project));
    if (distinctProjects.size < 2) continue;

    const valuesMatch = new Set(occurrences.map((o) => o.value)).size === 1;
    shared.push({ key, occurrences, valuesMatch });
  }

  shared.sort((a, b) => a.key.localeCompare(b.key));
  return shared;
}
