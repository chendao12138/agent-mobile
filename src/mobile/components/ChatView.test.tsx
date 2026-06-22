import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChatView, { type HistoryMessage } from './ChatView';
import type { RunState } from '../../core/run-state';

describe('ChatView', () => {
  it('shows empty state when no messages and no stream', () => {
    render(<ChatView messages={[]} streamState={null} />);
    expect(screen.getByText('发送消息开始与 Claude 对话')).toBeTruthy();
  });

  it('renders user message in right-aligned bubble', () => {
    const messages: HistoryMessage[] = [
      { role: 'user', content: 'Hello', timestamp: '2024-01-01T00:00:00Z' },
    ];
    const { container } = render(<ChatView messages={messages} streamState={null} />);

    // User messages use bg-cyan-600 class
    const userBubble = container.querySelector('.bg-cyan-600');
    expect(userBubble).toBeTruthy();
    expect(userBubble!.textContent).toContain('Hello');
  });

  it('renders assistant message in left-aligned bubble', () => {
    const messages: HistoryMessage[] = [
      { role: 'assistant', content: 'Hi there', timestamp: '' },
    ];
    const { container } = render(<ChatView messages={messages} streamState={null} />);

    const assistantBubble = container.querySelector('.bg-slate-800');
    expect(assistantBubble).toBeTruthy();
  });

  it('renders streaming state with reasoning', () => {
    const streamState: RunState = {
      blocks: [],
      reasoning: { content: 'Let me think about this...', active: true },
      footer: 'thinking',
      terminal: 'running',
    };
    render(<ChatView messages={[]} streamState={streamState} />);

    expect(screen.getByText('🧠 思考中…')).toBeTruthy();
    expect(screen.getByText('Let me think about this...')).toBeTruthy();
  });

  it('shows done indicator when terminal is done', () => {
    const streamState: RunState = {
      blocks: [],
      reasoning: { content: '', active: false },
      footer: null,
      terminal: 'done',
    };
    render(<ChatView messages={[]} streamState={streamState} />);

    expect(screen.getByText('✓')).toBeTruthy();
  });

  it('shows interrupted indicator', () => {
    const streamState: RunState = {
      blocks: [],
      reasoning: { content: '', active: false },
      footer: null,
      terminal: 'interrupted',
    };
    render(<ChatView messages={[]} streamState={streamState} />);

    expect(screen.getByText('⏹ 已中断')).toBeTruthy();
  });

  it('shows error indicator', () => {
    const streamState: RunState = {
      blocks: [],
      reasoning: { content: '', active: false },
      footer: null,
      terminal: 'error',
      errorMsg: 'Something broke',
    };
    render(<ChatView messages={[]} streamState={streamState} />);

    expect(screen.getByText(/Something broke/)).toBeTruthy();
  });

  it('renders tool blocks in streaming state', () => {
    const streamState: RunState = {
      blocks: [
        { kind: 'tool', tool: { id: 't1', name: 'Read', input: {}, status: 'running' } },
      ],
      reasoning: { content: '', active: false },
      footer: 'tool_running',
      terminal: 'running',
    };
    render(<ChatView messages={[]} streamState={streamState} />);

    // Tool block renders the tool name inside a span
    expect(screen.getByText('Read')).toBeTruthy();
    // Footer shows "调用工具中…"
    expect(screen.getByText('🔧 调用工具中…')).toBeTruthy();
  });
});
