import { describe, it, expect } from 'vitest';
import { reduce, initialState, markInterrupted, finalizeIfRunning, type RunState } from './run-state';
import type { AgentEvent } from '../agent/types';

// Helper to make a text event
function textEvt(delta: string): AgentEvent {
  return { type: 'text', delta };
}

// Helper to make a thinking event
function thinkingEvt(delta: string): AgentEvent {
  return { type: 'thinking', delta };
}

// Helper to make a tool_use event
function toolUse(id: string, name: string, input?: unknown): AgentEvent {
  return { type: 'tool_use', id, name, input };
}

// Helper to make a tool_result event
function toolResult(id: string, output: string, isError = false): AgentEvent {
  return { type: 'tool_result', id, output, isError };
}

describe('run-state', () => {
  describe('reduce', () => {
    it('starts from initial state', () => {
      expect(initialState.blocks).toEqual([]);
      expect(initialState.terminal).toBe('running');
      expect(initialState.footer).toBe('thinking');
    });

    describe('text events', () => {
      it('creates a new streaming text block on first text', () => {
        const state = reduce(initialState, textEvt('hello'));
        expect(state.blocks).toHaveLength(1);
        const block = state.blocks[0];
        expect(block?.kind).toBe('text');
        expect(block?.content).toBe('hello');
        expect(block?.streaming).toBe(true);
        expect(state.footer).toBe('streaming');
      });

      it('appends to existing streaming text block', () => {
        const s1 = reduce(initialState, textEvt('hello'));
        const s2 = reduce(s1, textEvt(' world'));
        expect(s2.blocks).toHaveLength(1);
        expect(s2.blocks[0]?.kind).toBe('text');
        expect(s2.blocks[0]?.content).toBe('hello world');
        expect(s2.blocks[0]?.streaming).toBe(true);
      });

      it('starts a new text block after tool blocks close the text stream', () => {
        // text → tool_use (closes text, adds tool block) → text (new text block)
        // Result: [text(closed), tool, text(streaming)] = 3 blocks
        const s1 = reduce(initialState, textEvt('before tool'));
        const s2 = reduce(s1, toolUse('t1', 'Bash'));
        const s3 = reduce(s2, textEvt('after tool'));
        expect(s3.blocks).toHaveLength(3);
        // Block 0: original text, now closed
        expect(s3.blocks[0]?.kind).toBe('text');
        expect((s3.blocks[0] as any).streaming).toBe(false);
        // Block 1: tool
        expect(s3.blocks[1]?.kind).toBe('tool');
        // Block 2: new streaming text
        expect(s3.blocks[2]?.kind).toBe('text');
        expect((s3.blocks[2] as any).streaming).toBe(true);
      });
    });

    describe('thinking events', () => {
      it('accumulates reasoning content', () => {
        const s1 = reduce(initialState, thinkingEvt('I need to...'));
        expect(s1.reasoning.content).toBe('I need to...');
        expect(s1.reasoning.active).toBe(true);
        expect(s1.footer).toBe('thinking');

        const s2 = reduce(s1, thinkingEvt(' check the file'));
        expect(s2.reasoning.content).toBe('I need to... check the file');
      });

      it('sets active to false when text arrives', () => {
        const s1 = reduce(initialState, thinkingEvt('hmm'));
        expect(s1.reasoning.active).toBe(true);
        const s2 = reduce(s1, textEvt('ok'));
        expect(s2.reasoning.active).toBe(false);
      });
    });

    describe('tool events', () => {
      it('creates a tool block with running status', () => {
        const s1 = reduce(initialState, toolUse('t1', 'Read'));
        const tool = s1.blocks[0];
        expect(tool?.kind).toBe('tool');
        expect((tool as any).tool.name).toBe('Read');
        expect((tool as any).tool.status).toBe('running');
        expect(s1.footer).toBe('tool_running');
      });

      it('updates tool status to done on tool_result', () => {
        const s1 = reduce(initialState, toolUse('t1', 'Read'));
        const s2 = reduce(s1, toolResult('t1', 'file content'));
        const tool = s2.blocks[0];
        expect(tool?.kind).toBe('tool');
        expect((tool as any).tool.status).toBe('done');
        expect((tool as any).tool.output).toBe('file content');
      });

      it('updates tool status to error on error tool_result', () => {
        const s1 = reduce(initialState, toolUse('t1', 'Bash'));
        const s2 = reduce(s1, toolResult('t1', 'command not found', true));
        const tool = s2.blocks[0];
        expect((tool as any).tool.status).toBe('error');
      });

      it('only updates the matching tool by id', () => {
        const s1 = reduce(initialState, toolUse('t1', 'Read'));
        const s2 = reduce(s1, toolUse('t2', 'Write'));
        const s3 = reduce(s2, toolResult('t1', 'done'));
        expect((s3.blocks[0] as any).tool.status).toBe('done');
        expect((s3.blocks[1] as any).tool.status).toBe('running'); // t2 still running
      });
    });

    describe('terminal events', () => {
      it('marks done with no footer', () => {
        const s1 = reduce(initialState, textEvt('hello'));
        const s2 = reduce(s1, { type: 'done' } as AgentEvent);
        expect(s2.terminal).toBe('done');
        expect(s2.footer).toBeNull();
        expect(s2.blocks[0]?.kind).toBe('text');
        expect((s2.blocks[0] as any).streaming).toBe(false);
      });

      it('marks error with error message', () => {
        const s1 = reduce(initialState, textEvt('hello'));
        const s2 = reduce(s1, { type: 'error', message: 'something broke' } as AgentEvent);
        expect(s2.terminal).toBe('error');
        expect(s2.errorMsg).toBe('something broke');
        expect(s2.footer).toBeNull();
      });
    });

    describe('unknown events', () => {
      it('returns same state for unknown event types', () => {
        const s1 = reduce(initialState, textEvt('hi'));
        const s2 = reduce(s1, { type: 'usage' } as AgentEvent);
        expect(s2.blocks).toEqual(s1.blocks); // usage event ignored
      });
    });
  });

  describe('markInterrupted', () => {
    it('sets terminal to interrupted and closes streaming', () => {
      const s1 = reduce(initialState, textEvt('in progress...'));
      const s2 = markInterrupted(s1);
      expect(s2.terminal).toBe('interrupted');
      expect(s2.footer).toBeNull();
      expect(s2.reasoning.active).toBe(false);
      expect((s2.blocks[0] as any).streaming).toBe(false);
    });
  });

  describe('finalizeIfRunning', () => {
    it('transitions running → done', () => {
      const s1 = reduce(initialState, textEvt('streaming...'));
      expect(s1.terminal).toBe('running');
      const s2 = finalizeIfRunning(s1);
      expect(s2.terminal).toBe('done');
      expect(s2.footer).toBeNull();
    });

    it('does nothing if already terminal', () => {
      const s1 = reduce(initialState, { type: 'error', message: 'x' } as AgentEvent);
      expect(s1.terminal).toBe('error');
      const s2 = finalizeIfRunning(s1);
      expect(s2.terminal).toBe('error'); // unchanged
    });
  });
});
