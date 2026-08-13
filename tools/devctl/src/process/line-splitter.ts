/** Accumulates raw stream chunks and emits complete lines, buffering any trailing partial line. */
export class LineSplitter {
  private buffer = '';

  constructor(private readonly onLine: (line: string) => void) {}

  push(chunk: string): void {
    this.buffer += chunk;
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIndex).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newlineIndex + 1);
      this.onLine(line);
    }
  }

  flush(): void {
    if (this.buffer.length > 0) {
      this.onLine(this.buffer.replace(/\r$/, ''));
      this.buffer = '';
    }
  }
}
