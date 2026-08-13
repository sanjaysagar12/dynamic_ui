import type { DiscoveredProject, ProjectEnv, ServicePort } from './types.js';

const PORT_ENV_KEYS = ['PORT', 'NEXT_PUBLIC_PORT', 'SERVER_PORT', 'HTTP_PORT'];
const PORT_FLAG_PATTERN = /(?:-p|--port)[= ](\d+)/;

export function detectPort(
  project: DiscoveredProject,
  env: ProjectEnv | undefined
): ServicePort {
  if (env) {
    for (const file of env.files) {
      for (const envKey of PORT_ENV_KEYS) {
        const found = file.vars.find((v) => v.key === envKey);
        if (found) {
          const port = Number(found.value);
          if (Number.isFinite(port) && port > 0) {
            return { project: project.name, port, source: 'env' };
          }
        }
      }
    }
  }

  const runTarget = project.targets.find((t) => t.name === project.runTarget);
  if (runTarget?.command) {
    const match = PORT_FLAG_PATTERN.exec(runTarget.command);
    if (match) {
      return { project: project.name, port: Number(match[1]), source: 'command' };
    }
  }

  return { project: project.name, port: null, source: 'unknown' };
}

export function isPortInUse(port: number, host = '127.0.0.1'): Promise<boolean> {
  return import('node:net').then(
    ({ createConnection }) =>
      new Promise<boolean>((resolve) => {
        const socket = createConnection({ port, host });
        socket.once('connect', () => {
          socket.destroy();
          resolve(true);
        });
        socket.once('error', () => {
          socket.destroy();
          resolve(false);
        });
      })
  );
}
