import type * as React from 'react';

import { cn } from '../../lib/utils';

type SeparatorProps = React.ComponentProps<'div'> & {
  decorative?: boolean;
  orientation?: 'horizontal' | 'vertical';
};

function Separator({ className, decorative = true, orientation = 'horizontal', ...props }: SeparatorProps) {
  return (
    <div
      role={decorative ? 'none' : 'separator'}
      aria-orientation={decorative ? undefined : orientation}
      data-slot="separator"
      data-orientation={orientation}
      className={cn('shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch', className)}
      {...props}
    />
  );
}

export { Separator };
