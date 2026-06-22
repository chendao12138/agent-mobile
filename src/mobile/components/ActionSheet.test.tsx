import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ActionSheet from './ActionSheet';

describe('ActionSheet', () => {
  const actions = [
    { label: '归档', action: vi.fn() },
    { label: '重命名', action: vi.fn() },
    { label: '删除', action: vi.fn(), danger: true },
  ];

  it('renders nothing when not visible', () => {
    const { container } = render(
      <ActionSheet visible={false} actions={actions} onClose={vi.fn()} />,
    );
    expect(container.textContent).toBe('');
  });

  it('renders all actions when visible', () => {
    render(
      <ActionSheet visible={true} title="Session A" actions={actions} onClose={vi.fn()} />,
    );

    expect(screen.getByText('Session A')).toBeTruthy();
    expect(screen.getByText('归档')).toBeTruthy();
    expect(screen.getByText('重命名')).toBeTruthy();
    expect(screen.getByText('删除')).toBeTruthy();
    expect(screen.getByText('取消')).toBeTruthy();
  });

  it('calls action and onClose when an action button is clicked', () => {
    const onClose = vi.fn();
    render(
      <ActionSheet visible={true} actions={actions} onClose={onClose} />,
    );

    fireEvent.click(screen.getByText('归档'));
    expect(actions[0]!.action).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when cancel is clicked', () => {
    const onClose = vi.fn();
    render(
      <ActionSheet visible={true} actions={actions} onClose={onClose} />,
    );

    fireEvent.click(screen.getByText('取消'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <ActionSheet visible={true} actions={actions} onClose={onClose} />,
    );

    const backdrop = container.querySelector('.absolute.inset-0');
    if (backdrop) fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });
});
