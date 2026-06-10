// Adapted from feishu-claude-code-bridge src/bot/pending-queue.ts

export interface QueueMessage {
  text: string;
  forkFrom?: string;
  attachmentIds?: string[];
  mode?: string;
  model?: string;
  timestamp: number;
}

/**
 * Debounce queue: collects rapid-fire messages into batches, flushes when
 * silence exceeds `debounceMs`. While blocked (a run is in flight), messages
 * accumulate without flushing. When unblocked, a fresh quiet-window timer
 * starts.
 */
export class PendingQueue {
  private readonly queues = new Map<string, QueueMessage[]>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly blocked = new Set<string>();
  private readonly debounceMs: number;
  private readonly onFlush: (scope: string, batch: QueueMessage[]) => void;

  constructor(debounceMs: number, onFlush: (scope: string, batch: QueueMessage[]) => void) {
    this.debounceMs = debounceMs;
    this.onFlush = onFlush;
  }

  push(scope: string, msg: QueueMessage): number {
    let q = this.queues.get(scope);
    if (!q) {
      q = [];
      this.queues.set(scope, q);
    }
    q.push(msg);
    this.armTimer(scope);
    return q.length;
  }

  block(scope: string): void {
    this.blocked.add(scope);
    this.clearTimer(scope);
  }

  unblock(scope: string): void {
    this.blocked.delete(scope);
    const q = this.queues.get(scope);
    if (q && q.length > 0) this.armTimer(scope);
  }

  cancel(scope: string): QueueMessage[] {
    this.clearTimer(scope);
    const q = this.queues.get(scope);
    if (!q) return [];
    this.queues.delete(scope);
    return q;
  }

  cancelAll(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.queues.clear();
    this.blocked.clear();
  }

  private armTimer(scope: string): void {
    if (this.blocked.has(scope)) return;
    this.clearTimer(scope);
    this.timers.set(
      scope,
      setTimeout(() => {
        this.timers.delete(scope);
        if (this.blocked.has(scope)) return;
        const q = this.queues.get(scope);
        if (!q || q.length === 0) return;
        this.queues.delete(scope);
        this.onFlush(scope, q);
      }, this.debounceMs),
    );
  }

  private clearTimer(scope: string): void {
    const t = this.timers.get(scope);
    if (t) {
      clearTimeout(t);
      this.timers.delete(scope);
    }
  }
}
