import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Toaster } from '../src/components/primitives/toaster';
import { getToastSnapshot, toast } from '../src/lib/toast';

afterEach(() => {
  for (const entry of getToastSnapshot()) toast.dismiss(entry.id);
  vi.useRealTimers();
});

describe('Toaster', () => {
  it('announces and dismisses a notification', () => {
    render(<Toaster />);

    act(() => {
      toast.success('Release published');
    });

    expect(screen.getByRole('status')).toHaveTextContent('Release published');
    fireEvent.click(screen.getByRole('button', { name: /Close|关闭/ }));
    expect(screen.queryByText('Release published')).not.toBeInTheDocument();
  });

  it('uses an assertive role for errors and expires notifications', () => {
    vi.useFakeTimers();
    render(<Toaster />);

    act(() => {
      toast.error('Publish failed', 1000);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Publish failed');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText('Publish failed')).not.toBeInTheDocument();
  });
});
