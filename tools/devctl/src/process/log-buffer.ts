export type LogStream = 'stdout' | 'stderr' | 'system';

export interface LogLine {
  timestamp: number;
  stream: LogStream;
  text: string;
}

/** Fixed-capacity ring buffer of log lines for a single service. */
export class LogBuffer {
  private lines: LogLine[] = [];
  private listeners = new Set<(line: LogLine) => void>();

  constructor(private readonly capacity = 5000) {}

  push(stream: LogStream, text: string): void {
    const line: LogLine = { timestamp: Date.now(), stream, text };
    this.lines.push(line);
    if (this.lines.length > this.capacity) {
      this.lines.splice(0, this.lines.length - this.capacity);
    }
    for (const listener of this.listeners) listener(line);
  }

  getLines(): readonly LogLine[] {
    return this.lines;
  }

  onLine(listener: (line: LogLine) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clear(): void {
    this.lines = [];
  }
}
