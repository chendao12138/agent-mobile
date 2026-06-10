// Adapted from feishu-claude-code-bridge src/bot/process-pool.ts

/**
 * FIFO concurrency cap for claude runs. Prevents dozens of concurrent
 * claude subprocesses from drowning RAM and API rate limits.
 */
export class ProcessPool {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private cap: () => number;

  constructor(cap: number | (() => number) = 5) {
    this.cap = typeof cap === 'function' ? cap : () => cap;
  }

  async acquire(): Promise<() => void> {
    if (this.active < this.cap()) {
      this.active++;
      return () => this.release();
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active++;
    return () => this.release();
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1);
    if (this.active < this.cap() && this.waiters.length > 0) {
      const next = this.waiters.shift();
      if (next) next();
    }
  }

  snapshot(): { active: number; waiting: number; cap: number } {
    return { active: this.active, waiting: this.waiters.length, cap: this.cap() };
  }
}
