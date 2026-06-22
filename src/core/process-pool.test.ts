import { describe, it, expect, vi } from 'vitest';
import { ProcessPool } from './process-pool';

describe('ProcessPool', () => {
  it('acquires immediately when under capacity', async () => {
    const pool = new ProcessPool(2);
    const release = await pool.acquire();
    expect(release).toBeTypeOf('function');
    expect(pool.snapshot()).toEqual({ active: 1, waiting: 0, cap: 2 });
  });

  it('blocks acquire when at capacity, releases FIFO', async () => {
    const pool = new ProcessPool(2);

    const r1 = await pool.acquire();
    const r2 = await pool.acquire();
    expect(pool.snapshot()).toEqual({ active: 2, waiting: 0, cap: 2 });

    // Third acquire is blocked
    const p3 = pool.acquire();

    // Let microtasks settle so p3 is queued
    await vi.waitFor(() => {
      expect(pool.snapshot().waiting).toBe(1);
    });

    // Release one slot
    r1();
    const r3 = await p3;
    expect(pool.snapshot()).toEqual({ active: 2, waiting: 0, cap: 2 }); // still at cap

    // Release all
    r2();
    r3();
    expect(pool.snapshot()).toEqual({ active: 0, waiting: 0, cap: 2 });
  });

  it('respects FIFO order for waiters', async () => {
    const pool = new ProcessPool(1);
    const r1 = await pool.acquire();

    const results: number[] = [];
    let resolve2!: () => void;
    let resolve3!: () => void;
    // Queue two waiters — they store the release function but don't call it yet
    void pool.acquire().then((r) => { results.push(1); resolve2 = r; });
    void pool.acquire().then((r) => { results.push(2); resolve3 = r; });

    await vi.waitFor(() => {
      expect(pool.snapshot().waiting).toBe(2);
    });

    r1(); // release → wakes first waiter
    await vi.waitFor(() => {
      expect(results).toEqual([1]);
    });

    // First waiter releases → wakes second
    resolve2!();
    await vi.waitFor(() => {
      expect(results).toEqual([1, 2]);
    });

    resolve3!();
    expect(results).toEqual([1, 2]);
  });

  it('supports dynamic cap function', async () => {
    let cap = 1;
    const pool = new ProcessPool(() => cap);

    await pool.acquire(); // active=1, at cap
    expect(pool.snapshot()).toEqual({ active: 1, waiting: 0, cap: 1 });

    // Increase cap at runtime
    cap = 3;
    // Now the same pool should allow more acquisitions
    const r2 = await pool.acquire(); // should succeed immediately
    expect(pool.snapshot().active).toBe(2);
    r2();
  });

  it('release beyond active count is safe (no negative)', async () => {
    const pool = new ProcessPool(1);
    const r = await pool.acquire();
    r();
    r(); // double release — should not go negative
    expect(pool.snapshot().active).toBe(0);
  });

  it('snapshot reflects accurate state', async () => {
    const pool = new ProcessPool(1);
    const r = await pool.acquire();
    expect(pool.snapshot()).toEqual({ active: 1, waiting: 0, cap: 1 });
    void pool.acquire().catch(() => {});
    await vi.waitFor(() => {
      expect(pool.snapshot().waiting).toBe(1);
    });
    r();
    await vi.waitFor(() => {
      expect(pool.snapshot().active).toBeGreaterThanOrEqual(0);
    });
  });
});
