import type * as React from 'react';

import { cn } from '../../lib/utils';

type ProgressProps = React.ComponentProps<'div'> & { value?: number | null; max?: number };

function Progress({ className, value = 0, max = 100, ...props }: ProgressProps) {
  const normalizedValue = Math.min(max, Math.max(0, value ?? 0));
  const percent = max > 0 ? (normalizedValue / max) * 100 : 0;

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={normalizedValue}
      data-slot="progress"
      className={cn('relative h-1 w-full overflow-hidden rounded-full bg-muted', className)}
      {...props}
    >
      <div data-slot="progress-indicator" className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
    </div>
  );
}

export { Progress };
