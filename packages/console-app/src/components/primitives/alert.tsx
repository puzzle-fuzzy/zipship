import type * as React from 'react';

import { cn } from '../../lib/utils';

type AlertProps = React.ComponentProps<'div'> & { variant?: 'default' | 'destructive' };

function Alert({ className, variant = 'default', ...props }: AlertProps) {
  return (
    <div
      role="alert"
      data-slot="alert"
      data-variant={variant}
      className={cn(
        'group/alert relative grid w-full gap-0.5 rounded-lg border px-2.5 py-2 text-left text-sm has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*=size-])]:size-4',
        variant === 'destructive'
          ? 'bg-card text-destructive *:data-[slot=alert-description]:text-destructive/90'
          : 'bg-card text-card-foreground',
        className,
      )}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="alert-title" className={cn('font-medium group-has-[>svg]/alert:col-start-2', className)} {...props} />;
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn('text-sm text-balance text-muted-foreground md:text-pretty [&_a]:underline [&_a]:underline-offset-3', className)}
      {...props}
    />
  );
}

function AlertAction({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="alert-action" className={cn('absolute top-2 right-2', className)} {...props} />;
}

export { Alert, AlertAction, AlertDescription, AlertTitle };
