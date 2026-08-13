import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import spawn from 'cross-spawn';
import treeKill from 'tree-kill';
import { resolveNxBin } from '../discovery/nx-bin.js';
import { isPortInUse } from '../discovery/ports.js';
import { LineSplitter } from './line-splitter.js';
import { LogBuffer } from './log-buffer.js';

export type ServiceStatus =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'errored';

export interface ServiceState {
  project: string;
  target: string;
  status: ServiceStatus;
  pid: number | null;
  port: number | null;
  startedAt: number | null;
  lastError: string | null;
}

interface ManagedService {
  state: ServiceState;
  child: ChildProcess | null;
  logBuffer: LogBuffer;
}

/**
 * Spawns and tracks `nx run <project>:<target>` processes. Killing goes through
 * tree-kill (rather than child.kill()) because nx spawns its own child processes
 * (the underlying webpack/next/node process); tree-kill terminates the whole tree
 * on both POSIX and Windows so the port is actually freed.
 */
export class ProcessManager extends EventEmitter {
  private services = new Map<string, ManagedService>();

  constructor(
    private readonly workspaceRoot: string,
    private readonly logDir: string | null = null
  ) {
    super();
  }

  register(project: string, target: string, port: number | null): void {
    if (this.services.has(project)) return;
    this.services.set(project, {
      state: {
        project,
        target,
        status: 'stopped',
        pid: null,
        port,
        startedAt: null,
        lastError: null,
      },
      child: null,
      logBuffer: new LogBuffer(),
    });
  }

  getState(project: string): ServiceState | undefined {
    return this.services.get(project)?.state;
  }

  getAllStates(): ServiceState[] {
    return [...this.services.values()].map((s) => s.state);
  }

  getLogBuffer(project: string): LogBuffer | undefined {
    return this.services.get(project)?.logBuffer;
  }

  async start(project: string): Promise<void> {
    const service = this.services.get(project);
    if (!service) throw new Error(`Unknown service: ${project}`);
    if (service.state.status === 'running' || service.state.status === 'starting') {
      return;
    }

    if (service.state.port !== null) {
      const inUse = await isPortInUse(service.state.port);
      if (inUse) {
        service.state.status = 'errored';
        service.state.lastError = `Port ${service.state.port} is already in use by another process`;
        this.emitChange(project);
        return;
      }
    }

    service.state.status = 'starting';
    service.state.lastError = null;
    this.emitChange(project);

    const nxBin = resolveNxBin(this.workspaceRoot);
    const child = spawn(
      process.execPath,
      [nxBin, 'run', `${project}:${service.state.target}`, '--output-style=stream'],
      {
        cwd: this.workspaceRoot,
        shell: false,
        env: process.env,
      }
    );

    service.child = child;
    service.state.pid = child.pid ?? null;
    service.state.startedAt = Date.now();

    const stdoutSplitter = new LineSplitter((line) =>
      this.appendLog(project, 'stdout', line)
    );
    const stderrSplitter = new LineSplitter((line) =>
      this.appendLog(project, 'stderr', line)
    );

    child.stdout?.on('data', (chunk: Buffer) => stdoutSplitter.push(chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => stderrSplitter.push(chunk.toString()));

    child.on('spawn', () => {
      if (service.state.status === 'starting') {
        service.state.status = 'running';
      }
      this.emitChange(project);
    });

    child.on('error', (err) => {
      service.state.status = 'errored';
      service.state.lastError = err.message;
      this.appendLog(project, 'system', `Process error: ${err.message}`);
      this.emitChange(project);
    });

    child.on('exit', (code, signal) => {
      stdoutSplitter.flush();
      stderrSplitter.flush();
      const wasStopping = service.state.status === 'stopping';
      service.state.status = wasStopping || code === 0 ? 'stopped' : 'errored';
      if (!wasStopping && code !== 0) {
        service.state.lastError = `Exited with code ${code}${
          signal ? ` (signal ${signal})` : ''
        }`;
      }
      service.state.pid = null;
      service.child = null;
      this.appendLog(project, 'system', `Process exited (code=${code}, signal=${signal})`);
      this.emitChange(project);
    });
  }

  async stop(project: string): Promise<void> {
    const service = this.services.get(project);
    if (!service || !service.child || service.state.pid === null) return;

    service.state.status = 'stopping';
    this.emitChange(project);

    const pid = service.state.pid;
    await new Promise<void>((resolve) => {
      treeKill(pid, 'SIGTERM', (err) => {
        if (err) {
          this.appendLog(project, 'system', `tree-kill error: ${err.message}`);
        }
        resolve();
      });
    });
  }

  async restart(project: string): Promise<void> {
    await this.stop(project);
    await this.waitForStop(project);
    await this.start(project);
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.services.keys()].map((project) => this.stop(project)));
    await Promise.all(
      [...this.services.keys()].map((project) => this.waitForStop(project))
    );
  }

  private waitForStop(project: string, timeoutMs = 10000): Promise<void> {
    const service = this.services.get(project);
    if (!service || service.child === null) return Promise.resolve();

    return new Promise((resolve) => {
      const startedAt = Date.now();
      const check = () => {
        const current = this.services.get(project);
        if (!current || current.child === null) {
          resolve();
          return;
        }
        if (Date.now() - startedAt > timeoutMs) {
          resolve();
          return;
        }
        setTimeout(check, 100);
      };
      check();
    });
  }

  private appendLog(project: string, stream: 'stdout' | 'stderr' | 'system', text: string): void {
    const service = this.services.get(project);
    if (!service) return;
    service.logBuffer.push(stream, text);

    if (this.logDir) {
      try {
        mkdirSync(this.logDir, { recursive: true });
        appendFileSync(
          join(this.logDir, `${project}.log`),
          `[${new Date().toISOString()}] [${stream}] ${text}\n`
        );
      } catch {
        // Disk logging is best-effort; the in-memory ring buffer is authoritative.
      }
    }
  }

  private emitChange(project: string): void {
    const service = this.services.get(project);
    if (!service) return;
    this.emit('change', project, service.state);
  }
}
