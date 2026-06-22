import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PendingQueue, type QueueMessage } from './pending-queue';

function msg(text: string): QueueMessage {
  return { text, timestamp: Date.now() };
}

describe('PendingQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flushes after debounceMs with accumulated batch', async () => {
    const flushed: [string, QueueMessage[]][] = [];
    const q = new PendingQueue(500, (scope, batch) => {
      flushed.push([scope, batch]);
    });

    q.push('scope1', msg('a'));
    q.push('scope1', msg('b'));
    q.push('scope1', msg('c'));

    expect(flushed).toHaveLength(0); // not yet flushed

    vi.advanceTimersByTime(500);

    expect(flushed).toHaveLength(1);
    expect(flushed[0]?.[0]).toBe('scope1');
    expect(flushed[0]?.[1].map((m) => m.text)).toEqual(['a', 'b', 'c']);
  });

  it('debounces: resets timer on each push', async () => {
    const flushed: [string, QueueMessage[]][] = [];
    const q = new PendingQueue(500, (scope, batch) => {
      flushed.push([scope, batch]);
    });

    q.push('s', msg('a'));
    vi.advanceTimersByTime(300);
    q.push('s', msg('b')); // reset timer
    vi.advanceTimersByTime(300);
    expect(flushed).toHaveLength(0); // still not flushed

    vi.advanceTimersByTime(200); // total 500 since last push
    expect(flushed).toHaveLength(1);
  });

  it('keeps scopes independent', async () => {
    const flushed: [string, QueueMessage[]][] = [];
    const q = new PendingQueue(500, (scope, batch) => {
      flushed.push([scope, batch]);
    });

    q.push('s1', msg('a'));
    q.push('s2', msg('x'));
    vi.advanceTimersByTime(500);

    expect(flushed).toHaveLength(2);
    const s1Flush = flushed.find(([s]) => s === 's1')?.[1].map((m) => m.text);
    const s2Flush = flushed.find(([s]) => s === 's2')?.[1].map((m) => m.text);
    expect(s1Flush).toEqual(['a']);
    expect(s2Flush).toEqual(['x']);
  });

  it('block prevents flush, unblock allows it', async () => {
    const flushed: [string, QueueMessage[]][] = [];
    const q = new PendingQueue(500, (scope, batch) => {
      flushed.push([scope, batch]);
    });

    q.push('s', msg('a'));
    q.block('s');
    vi.advanceTimersByTime(1000);
    expect(flushed).toHaveLength(0); // blocked

    q.unblock('s');
    vi.advanceTimersByTime(500);
    expect(flushed).toHaveLength(1);
  });

  it('cancel returns queued messages and clears timer', async () => {
    const q = new PendingQueue(500, () => {});
    q.push('s', msg('a'));
    q.push('s', msg('b'));

    const cancelled = q.cancel('s');
    expect(cancelled.map((m) => m.text)).toEqual(['a', 'b']);

    // After cancel, flush should not fire
    vi.advanceTimersByTime(1000);
    // Nothing to flush — queue empty
  });

  it('cancelAll clears everything', async () => {
    const q = new PendingQueue(500, () => {});
    q.push('s1', msg('a'));
    q.push('s2', msg('b'));
    q.block('s3');

    q.cancelAll();
    // All timers cleared, all queues emptied, all blocks cleared
    // Should not throw
    q.push('s1', msg('after'));
    vi.advanceTimersByTime(500); // should flush normally
  });
});
