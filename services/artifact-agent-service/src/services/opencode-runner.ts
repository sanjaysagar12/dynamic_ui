import spawn = require('cross-spawn');
import { ArtifactGenerationError } from './providers.js';

export interface OpenCodeResult {
  reply: string;
  sessionId: string | null;
}

interface OpenCodeEvent {
  sessionID?: string;
  type?: string;
  part?: { type?: string; text?: string };
}

export class OpenCodeRunner {
  constructor(
    private readonly bin: string,
    private readonly timeoutMs: number,
  ) {}

  run(directory: string, prompt: string, model: string, sessionId: string | null): Promise<OpenCodeResult> {
    const args = ['run', '--dir', directory, '--format', 'json', '--model', model];
    if (sessionId) {
      args.push('--session', sessionId);
    }
    args.push(prompt);

    return new Promise((resolvePromise, reject) => {
      // stdin must be explicitly closed: Node's default pipe stays open with
      // nothing written to it, and opencode blocks reading it waiting for
      // EOF that never comes (Python's subprocess default instead inherited
      // the parent's real TTY stdin, which opencode doesn't block on).
      const child = spawn(this.bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        reject(new ArtifactGenerationError(`opencode timed out after ${this.timeoutMs / 1000}s`));
      }, this.timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf-8');
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf-8');
      });

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new ArtifactGenerationError(`opencode binary '${this.bin}' was not found on PATH: ${err.message}`));
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        if (code !== 0) {
          reject(
            new ArtifactGenerationError(`opencode exited with status ${code}: ${stderr.trim() || stdout.trim()}`),
          );
          return;
        }

        const { reply, sessionId: resolvedSessionId } = parseEvents(stdout);
        if (reply === null) {
          reject(new ArtifactGenerationError('opencode produced no text reply'));
          return;
        }

        resolvePromise({ reply, sessionId: resolvedSessionId ?? sessionId });
      });
    });
  }
}

function parseEvents(stdout: string): { reply: string | null; sessionId: string | null } {
  let reply: string | null = null;
  let sessionId: string | null = null;

  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    let event: OpenCodeEvent;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    sessionId = event.sessionID || sessionId;

    const part = event.part ?? {};
    if (event.type === 'text' && part.type === 'text') {
      const text = part.text;
      if (typeof text === 'string' && text) {
        reply = text;
      }
    }
  }

  return { reply, sessionId };
}
