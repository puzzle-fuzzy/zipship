import { useState } from 'react';
import type * as React from 'react';

import { cn } from '../../lib/utils';

type SwitchProps = Omit<React.ComponentProps<'button'>, 'onChange'> & {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  size?: 'sm' | 'default';
};

function Switch({
  checked,
  defaultChecked = false,
  onCheckedChange,
  className,
  disabled,
  size = 'default',
  type = 'button',
  onClick,
  ...props
}: SwitchProps) {
  const [uncontrolledChecked, setUncontrolledChecked] = useState(defaultChecked);
  const isChecked = checked ?? uncontrolledChecked;

  return (
    <button
      {...props}
      type={type}
      role="switch"
      aria-checked={isChecked}
      disabled={disabled}
      data-slot="switch"
      data-size={size}
      data-checked={isChecked ? '' : undefined}
      className={cn(
        'group/switch relative inline-flex shrink-0 items-center rounded-full border border-transparent bg-input transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-[18px] data-[size=default]:w-8 data-[size=sm]:h-3.5 data-[size=sm]:w-6 data-checked:bg-primary',
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        const nextChecked = !isChecked;
        if (checked === undefined) setUncontrolledChecked(nextChecked);
        onCheckedChange?.(nextChecked);
      }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none block size-4 translate-x-0 rounded-full bg-background shadow-sm transition-transform group-data-[size=sm]/switch:size-3 group-data-checked/switch:translate-x-3.5 group-data-[size=sm]/switch:group-data-checked/switch:translate-x-2.5 dark:bg-foreground"
      />
    </button>
  );
}

export { Switch };
