import { describe, it, expect } from 'vitest';
import type { AgentEvent } from '../types';
import { translateEvent } from './stream-json';

function collect(raw: unknown): AgentEvent[] {
  return [...translateEvent(raw)];
}

describe('stream-json translateEvent', () => {
  describe('system init', () => {
    it('yields a system event with sessionId/cwd/model', () => {
      const events = collect({
        type: 'system',
        subtype: 'init',
        session_id: 'abc123',
        cwd: '/home/user/project',
        model: 'sonnet',
      });
      expect(events).toEqual([
        {
          type: 'system',
          sessionId: 'abc123',
          cwd: '/home/user/project',
          model: 'sonnet',
        },
      ]);
    });
  });

  describe('assistant message', () => {
    it('yields text deltas', () => {
      const events = collect({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Hello from Claude' }],
        },
      });
      expect(events).toEqual([
        { type: 'text', delta: 'Hello from Claude' },
      ]);
    });

    it('yields thinking deltas', () => {
      const events = collect({
        type: 'assistant',
        message: {
          content: [{ type: 'thinking', thinking: 'I should check...' }],
        },
      });
      expect(events).toEqual([
        { type: 'thinking', delta: 'I should check...' },
      ]);
    });

    it('yields tool_use events', () => {
      const events = collect({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }],
        },
      });
      expect(events).toEqual([
        { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
      ]);
    });

    it('yields multiple events for multiple content blocks', () => {
      const events = collect({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Let me check...' },
            { type: 'tool_use', id: 't1', name: 'Read', input: { path: '/f' } },
          ],
        },
      });
      expect(events).toHaveLength(2);
      expect(events[0]?.type).toBe('text');
      expect(events[1]?.type).toBe('tool_use');
    });

    it('skips empty text blocks', () => {
      const events = collect({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: '' }],
        },
      });
      // Empty string is falsy (typeof string && text !== '' check)
      expect(events).toHaveLength(0);
    });

    it('skips blocks with missing required fields', () => {
      const events = collect({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: null, name: null }],
        },
      });
      expect(events).toHaveLength(0);
    });
  });

  describe('user message with tool_result', () => {
    it('yields tool_result events', () => {
      const events = collect({
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 't1', content: 'file contents here' },
          ],
        },
      });
      expect(events).toEqual([
        { type: 'tool_result', id: 't1', output: 'file contents here', isError: false },
      ]);
    });

    it('marks isError when is_error is true', () => {
      const events = collect({
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 't1', content: 'error', is_error: true },
          ],
        },
      });
      expect(events[0]).toEqual({
        type: 'tool_result',
        id: 't1',
        output: 'error',
        isError: true,
      });
    });

    it('stringifies non-string content', () => {
      const events = collect({
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 't1', content: { foo: 'bar' } },
          ],
        },
      });
      expect(events[0]?.output).toBe('{"foo":"bar"}');
    });
  });

  describe('result event', () => {
    it('yields usage and done events', () => {
      const events = collect({
        type: 'result',
        session_id: 'abc',
        usage: { input_tokens: 100, output_tokens: 50 },
        total_cost_usd: 0.05,
      });
      expect(events).toEqual([
        { type: 'usage', inputTokens: 100, outputTokens: 50, costUsd: 0.05 },
        { type: 'done', sessionId: 'abc' },
      ]);
    });

    it('yields done without usage if no usage block', () => {
      const events = collect({
        type: 'result',
        session_id: 'abc',
      });
      expect(events).toEqual([
        { type: 'done', sessionId: 'abc' },
      ]);
    });
  });

  describe('edge cases', () => {
    it('returns empty for null/undefined', () => {
      expect(collect(null)).toEqual([]);
      expect(collect(undefined)).toEqual([]);
    });

    it('returns empty for non-object', () => {
      expect(collect('just a string')).toEqual([]);
      expect(collect(42)).toEqual([]);
    });

    it('returns empty for unknown event types', () => {
      expect(collect({ type: 'unknown_type' })).toEqual([]);
    });

    it('returns empty for message-less events', () => {
      expect(collect({ type: 'assistant' })).toEqual([]);
    });
  });
});
