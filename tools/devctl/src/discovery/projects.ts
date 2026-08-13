import { execCommand } from '../process/exec.js';
import { resolveNxBin } from './nx-bin.js';
import type { DiscoveredProject, DiscoveredTarget, Warning } from './types.js';

const RUN_TARGET_PRIORITY = ['serve', 'dev'];

interface NxTargetJson {
  executor?: string;
  options?: { command?: unknown };
}

interface NxProjectJson {
  root?: string;
  projectType?: string;
  targets?: Record<string, NxTargetJson>;
}

export async function discoverProjects(
  workspaceRoot: string
): Promise<{ projects: DiscoveredProject[]; warnings: Warning[] }> {
  const warnings: Warning[] = [];
  const nxBin = resolveNxBin(workspaceRoot);

  const namesResult = await execCommand(
    process.execPath,
    [nxBin, 'show', 'projects', '--json'],
    workspaceRoot
  );
  if (namesResult.code !== 0) {
    throw new Error(`"nx show projects --json" failed: ${namesResult.stderr}`);
  }

  let names: string[];
  try {
    names = JSON.parse(namesResult.stdout);
  } catch (err) {
    throw new Error(
      `Could not parse "nx show projects --json" output: ${(err as Error).message}`
    );
  }

  const projects: DiscoveredProject[] = [];
  for (const name of names) {
    try {
      projects.push(await discoverProject(workspaceRoot, nxBin, name));
    } catch (err) {
      warnings.push({
        scope: name,
        message: `Skipped project "${name}": ${(err as Error).message}`,
      });
    }
  }

  projects.sort((a, b) => a.name.localeCompare(b.name));
  return { projects, warnings };
}

async function discoverProject(
  workspaceRoot: string,
  nxBin: string,
  name: string
): Promise<DiscoveredProject> {
  const result = await execCommand(
    process.execPath,
    [nxBin, 'show', 'project', name, '--json'],
    workspaceRoot
  );
  if (result.code !== 0) {
    throw new Error(`"nx show project ${name} --json" failed: ${result.stderr}`);
  }

  const detail: NxProjectJson = JSON.parse(result.stdout);
  const targets: DiscoveredTarget[] = Object.entries(detail.targets ?? {}).map(
    ([targetName, target]) => ({
      name: targetName,
      executor: target.executor,
      command:
        typeof target.options?.command === 'string'
          ? target.options.command
          : undefined,
    })
  );

  const runTarget =
    RUN_TARGET_PRIORITY.find((candidate) =>
      targets.some((target) => target.name === candidate)
    ) ?? null;

  return {
    name,
    root: detail.root ?? '',
    projectType: detail.projectType,
    targets,
    runTarget,
  };
}
