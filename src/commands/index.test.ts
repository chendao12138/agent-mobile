import { describe, it, expect, vi } from 'vitest';
import { tryHandleCommand, type CommandContext } from './index';
import type { AgentAdapter } from '../agent/types';
import { ActiveRuns } from '../core/active-runs';

function mockAgent(): AgentAdapter {
  return {
    id: 'test',
    displayName: 'Test Agent',
    isAvailable: vi.fn().mockResolvedValue(true),
    run: vi.fn(),
  };
}

function mockCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    text: '',
    workspace: 'test-ws',
    sessionId: 'test-sid',
    activeRuns: new ActiveRuns(),
    agent: mockAgent(),
    ...overrides,
  };
}

describe('commands', () => {
  it('returns null for non-slash text', async () => {
    const result = await tryHandleCommand({
      ...mockCtx(),
      text: 'hello claude',
    });
    expect(result).toBeNull();
  });

  it('returns null for unknown slash command', async () => {
    const result = await tryHandleCommand({
      ...mockCtx(),
      text: '/unknown',
    });
    expect(result).toBeNull();
  });

  describe('/new (alias /reset)', () => {
    it('returns ok with newSession true', async () => {
      for (const cmd of ['/new', '/reset']) {
        const result = await tryHandleCommand({ ...mockCtx(), text: cmd });
        expect(result?.ok).toBe(true);
        expect(result?.data).toEqual({ newSession: true });
      }
    });

    it('accepts optional name', async () => {
      const result = await tryHandleCommand({
        ...mockCtx(),
        text: '/new my session',
      });
      expect(result?.ok).toBe(true);
      expect(result?.message).toContain('my session');
    });
  });

  describe('/stop', () => {
    it('calls interrupt on activeRuns', async () => {
      const activeRuns = new ActiveRuns();
      const interruptSpy = vi.spyOn(activeRuns, 'interrupt');
      const result = await tryHandleCommand({
        ...mockCtx({ activeRuns }),
        text: '/stop',
      });
      expect(interruptSpy).toHaveBeenCalledWith('test-ws:test-sid');
      expect(result?.ok).toBe(true);
    });
  });

  describe('/rename', () => {
    it('returns error when no name given', async () => {
      const result = await tryHandleCommand({
        ...mockCtx(),
        text: '/rename',
      });
      expect(result?.ok).toBe(false);
      expect(result?.message).toContain('用法');
    });
  });

  describe('/mode', () => {
    it.each(['plan', 'auto', 'bypass'])('accepts %s', async (mode) => {
      const result = await tryHandleCommand({
        ...mockCtx(),
        text: `/mode ${mode}`,
      });
      expect(result?.ok).toBe(true);
      expect(result?.message).toContain(mode);
    });

    it('rejects invalid mode', async () => {
      const result = await tryHandleCommand({
        ...mockCtx(),
        text: '/mode invalid',
      });
      expect(result?.ok).toBe(false);
    });
  });

  describe('/help', () => {
    it('returns non-empty help message', async () => {
      const result = await tryHandleCommand({
        ...mockCtx(),
        text: '/help',
      });
      expect(result?.ok).toBe(true);
      expect(result?.message).toBeTruthy();
      expect(result?.message.length).toBeGreaterThan(20);
    });
  });

  describe('/status', () => {
    it('returns session info', async () => {
      const result = await tryHandleCommand({
        ...mockCtx(),
        text: '/status',
      });
      expect(result?.ok).toBe(true);
      expect(result?.message).toContain('test-ws');
      expect(result?.message).toContain('Test Agent');
    });
  });
});
