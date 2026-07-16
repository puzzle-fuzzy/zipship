import type * as React from 'react';

import { cn } from '../../lib/utils';

type SelectProps = Omit<React.ComponentProps<'select'>, 'onChange' | 'size'> & {
  onChange?: React.ChangeEventHandler<HTMLSelectElement>;
  onValueChange?: (value: string) => void;
  size?: 'sm' | 'default';
};

function Select({ className, onChange, onValueChange, size = 'default', ...props }: SelectProps) {
  return (
    <select
      data-slot="select"
      data-size={size}
      className={cn(
        'w-fit appearance-auto rounded-lg border border-input bg-background px-2.5 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-[size=default]:h-8 data-[size=sm]:h-7',
        className,
      )}
      onChange={(event) => {
        onChange?.(event);
        onValueChange?.(event.currentTarget.value);
      }}
      {...props}
    />
  );
}

export { Select };
