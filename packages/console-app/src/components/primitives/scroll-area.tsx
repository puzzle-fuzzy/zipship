import type * as React from 'react';

import { cn } from '../../lib/utils';

function ScrollArea({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="scroll-area" className={cn('relative overflow-auto overscroll-contain', className)} {...props} />;
}

function ScrollBar({ className, orientation = 'vertical', ...props }: React.ComponentProps<'div'> & { orientation?: 'horizontal' | 'vertical' }) {
  return <div aria-hidden="true" data-slot="scroll-area-scrollbar" data-orientation={orientation} className={cn('hidden', className)} {...props} />;
}

export { ScrollArea, ScrollBar };
