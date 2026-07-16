import type * as React from 'react';

import { cn } from '../lib/utils';

type MaterialIconProps = Omit<React.ComponentProps<'span'>, 'children'> & {
  name: string;
};

export function MaterialIcon({
  name,
  className,
  'aria-hidden': ariaHidden = true,
  ...props
}: MaterialIconProps) {
  return (
    <span
      aria-hidden={ariaHidden}
      className={cn('material-symbols-outlined', className)}
      {...props}
    >
      {name}
    </span>
  );
}
