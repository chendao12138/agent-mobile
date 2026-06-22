import { describe, it, expect, vi } from 'vitest';
import { ActiveRuns, type RunHandle } from './active-runs';
import type { AgentRun } from '../agent/types';

function mockRun(): AgentRun {
  return {
    events: (async function* () {})(),
    stop: vi.fn().mockResolvedValue(undefined),
    waitForExit: vi.fn().mockResolvedValue(true),
  };
}

describe('ActiveRuns', () => {
  it('registers a run and retrieves it', () => {
    const runs = new ActiveRuns();
    const run = mockRun();
    const handle = runs.register('ws:session-1', run);

    expect(handle).toBeDefined();
    expect(handle.run).toBe(run);
    expect(handle.interrupted).toBe(false);

    const found = runs.get('ws:session-1');
    expect(found).toBe(handle);
  });

  it('get returns undefined for unknown scope', () => {
    const runs = new ActiveRuns();
    expect(runs.get('nonexistent')).toBeUndefined();
  });

  it('interrupt sets interrupted and calls stop', () => {
    const runs = new ActiveRuns();
    const run = mockRun();
    runs.register('ws:session-1', run);

    const result = runs.interrupt('ws:session-1');
    expect(result).toBe(true);

    // Handle is removed
    expect(runs.get('ws:session-1')).toBeUndefined();

    // stop() was called
    expect(run.stop).toHaveBeenCalledOnce();
  });

  it('interrupt returns false for unknown scope', () => {
    const runs = new ActiveRuns();
    expect(runs.interrupt('nope')).toBe(false);
  });

  it('unregister removes specific run', () => {
    const runs = new ActiveRuns();
    const run = mockRun();
    runs.register('scope', run);
    runs.unregister('scope', run);

    expect(runs.get('scope')).toBeUndefined();
  });

  it('unregister does not remove if run instance differs', () => {
    const runs = new ActiveRuns();
    const r1 = mockRun();
    const r2 = mockRun();
    runs.register('scope', r1);
    runs.unregister('scope', r2); // wrong instance

    expect(runs.get('scope')).toBeDefined();
    expect(runs.get('scope')!.run).toBe(r1);
  });

  it('stopAll interrupts all handles', async () => {
    const runs = new ActiveRuns();
    const r1 = mockRun();
    const r2 = mockRun();
    runs.register('s1', r1);
    runs.register('s2', r2);

    await runs.stopAll();

    expect(r1.stop).toHaveBeenCalled();
    expect(r2.stop).toHaveBeenCalled();
    // All handles removed
    expect(runs.get('s1')).toBeUndefined();
    expect(runs.get('s2')).toBeUndefined();
  });
});
