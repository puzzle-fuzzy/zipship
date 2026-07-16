import { useMemo } from 'react';
import type * as React from 'react';

import { cn } from '../../lib/utils';
import { Label } from './label';
import { Separator } from './separator';

function FieldSet({ className, ...props }: React.ComponentProps<'fieldset'>) {
  return <fieldset data-slot="field-set" className={cn('flex flex-col gap-4', className)} {...props} />;
}

function FieldLegend({ className, variant = 'legend', ...props }: React.ComponentProps<'legend'> & { variant?: 'legend' | 'label' }) {
  return <legend data-slot="field-legend" data-variant={variant} className={cn('mb-1.5 font-medium data-[variant=label]:text-sm data-[variant=legend]:text-base', className)} {...props} />;
}

function FieldGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="field-group" className={cn('group/field-group flex w-full flex-col gap-5', className)} {...props} />;
}

type FieldProps = React.ComponentProps<'div'> & { orientation?: 'vertical' | 'horizontal' | 'responsive' };

function Field({ className, orientation = 'vertical', ...props }: FieldProps) {
  return (
    <div
      data-slot="field"
      data-orientation={orientation}
      className={cn(
        'group/field flex w-full gap-2 data-[invalid=true]:text-destructive',
        orientation === 'vertical' && 'flex-col *:w-full [&>.sr-only]:w-auto',
        orientation === 'horizontal' && 'flex-row items-center has-[>[data-slot=field-content]]:items-start',
        orientation === 'responsive' && 'flex-col *:w-full sm:flex-row sm:items-center sm:*:w-auto',
        className,
      )}
      {...props}
    />
  );
}

function FieldContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="field-content" className={cn('flex flex-1 flex-col gap-0.5 leading-snug', className)} {...props} />;
}

function FieldLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
  return <Label data-slot="field-label" className={cn('flex w-fit gap-2 leading-snug has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col has-[>[data-slot=field]]:rounded-lg has-[>[data-slot=field]]:border', className)} {...props} />;
}

function FieldTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="field-title" className={cn('flex w-fit items-center gap-2 text-sm font-medium', className)} {...props} />;
}

function FieldDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return <p data-slot="field-description" className={cn('text-left text-sm leading-normal font-normal text-muted-foreground [&>a]:underline [&>a]:underline-offset-4', className)} {...props} />;
}

function FieldSeparator({ children, className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="field-separator" className={cn('relative -my-2 h-5 text-sm', className)} {...props}>
      <Separator className="absolute inset-0 top-1/2" />
      {children ? <span className="relative mx-auto block w-fit bg-background px-2 text-muted-foreground">{children}</span> : null}
    </div>
  );
}

function FieldError({ className, children, errors, ...props }: React.ComponentProps<'div'> & { errors?: Array<{ message?: string } | undefined> }) {
  const content = useMemo(() => {
    if (children) return children;
    if (!errors?.length) return null;
    const uniqueMessages = [...new Set(errors.map((error) => error?.message).filter(Boolean))];
    if (uniqueMessages.length === 1) return uniqueMessages[0];
    return <ul className="ml-4 list-disc">{uniqueMessages.map((message) => <li key={message}>{message}</li>)}</ul>;
  }, [children, errors]);

  if (!content) return null;
  return <div role="alert" data-slot="field-error" className={cn('text-sm font-normal text-destructive', className)} {...props}>{content}</div>;
}

export { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSeparator, FieldSet, FieldTitle };
