import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PromptInput, { type PendingAttachment } from './PromptInput';

function noop() {}
const emptyAttachments: PendingAttachment[] = [];

describe('PromptInput', () => {
  const baseProps = {
    onSend: vi.fn(),
    onStop: vi.fn(),
    isRunning: false,
    mode: 'bypass',
    onToggleMode: vi.fn(),
    model: 'sonnet',
    onToggleModel: vi.fn(),
    attachments: emptyAttachments,
    canAttach: false,
    onAttachFiles: vi.fn(),
    onRemoveAttachment: vi.fn(),
    onAttachUnavailable: vi.fn(),
  };

  it('calls onSend with trimmed text when send button clicked', () => {
    const onSend = vi.fn();
    render(
      <PromptInput {...baseProps} onSend={onSend} />,
    );

    const textarea = screen.getByPlaceholderText('输入消息…');
    fireEvent.change(textarea, { target: { value: '  hello world  ' } });
    fireEvent.click(screen.getByText('↑'));

    expect(onSend).toHaveBeenCalledWith('hello world');
  });

  it('calls onSend on Enter (without Shift)', () => {
    const onSend = vi.fn();
    render(
      <PromptInput {...baseProps} onSend={onSend} />,
    );

    const textarea = screen.getByPlaceholderText('输入消息…');
    fireEvent.change(textarea, { target: { value: 'test' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(onSend).toHaveBeenCalledWith('test');
  });

  it('send button is disabled when text is empty and no attachments', () => {
    render(<PromptInput {...baseProps} />);

    const sendBtn = screen.getByText('↑').closest('button');
    expect(sendBtn?.disabled).toBe(true);
  });

  it('shows stop button when isRunning is true', () => {
    render(
      <PromptInput {...baseProps} isRunning={true} />,
    );

    expect(screen.getByText('⏹ 终止运行')).toBeTruthy();
  });

  it('textarea is readonly when isRunning', () => {
    render(
      <PromptInput {...baseProps} isRunning={true} />,
    );

    const textarea = screen.getByPlaceholderText('Claude 正在运行中…');
    expect((textarea as HTMLTextAreaElement).readOnly).toBe(true);
  });

  it('shows attachment chips with remove button', () => {
    const attachments: PendingAttachment[] = [
      { id: 'att1', name: 'test.pdf', size: 2048576, category: 'pdf', uploading: false },
    ];

    render(
      <PromptInput {...baseProps} attachments={attachments} />,
    );

    expect(screen.getByText('test.pdf')).toBeTruthy();
    // 2048576 / 1048576 ≈ 2.0MB
    expect(screen.getByText('2.0M')).toBeTruthy();
    expect(screen.getByText('PDF')).toBeTruthy();
  });
});
