import type * as React from 'react';

import { cn } from '../../lib/utils';

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'link';

const variantClassNames: Record<BadgeVariant, string> = {
  default: 'bg-primary text-primary-foreground',
  secondary: 'bg-secondary text-secondary-foreground',
  destructive: 'bg-destructive/10 text-destructive',
  outline: 'border-border text-foreground',
  ghost: 'hover:bg-muted hover:text-muted-foreground',
  link: 'text-primary underline-offset-4 hover:underline',
};

function badgeVariants({ variant = 'default', className }: { variant?: BadgeVariant; className?: string } = {}) {
  return cn(
    'inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 [&>svg]:pointer-events-none [&>svg]:size-3',
    variantClassNames[variant],
    className,
  );
}

type BadgeProps = React.ComponentProps<'span'> & { variant?: BadgeVariant };

function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return <span data-slot="badge" data-variant={variant} className={badgeVariants({ variant, className })} {...props} />;
}

export { Badge };
