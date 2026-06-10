// Adapted from feishu-claude-code-bridge src/bot/active-runs.ts

import type { AgentRun } from '../agent/types';

export interface RunHandle {
  run: AgentRun;
  interrupted: boolean;
}

export class ActiveRuns {
  private readonly handles = new Map<string, RunHandle>();

  /** scope = workspace:sessionName */
  register(scope: string, run: AgentRun): RunHandle {
    const handle: RunHandle = { run, interrupted: false };
    this.handles.set(scope, handle);
    return handle;
  }

  unregister(scope: string, run: AgentRun): void {
    const existing = this.handles.get(scope);
    if (existing?.run === run) this.handles.delete(scope);
  }

  get(scope: string): RunHandle | undefined {
    return this.handles.get(scope);
  }

  interrupt(scope: string): boolean {
    const h = this.handles.get(scope);
    if (!h) return false;
    h.interrupted = true;
    this.handles.delete(scope);
    void h.run.stop().catch(() => {});
    return true;
  }

  async stopAll(): Promise<void> {
    const all = [...this.handles.values()];
    this.handles.clear();
    for (const h of all) h.interrupted = true;
    await Promise.allSettled(all.map((h) => h.run.stop()));
  }
}
