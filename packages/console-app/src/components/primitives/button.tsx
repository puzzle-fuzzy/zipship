/* oxlint-disable react/only-export-components -- link-style buttons share the same Tailwind recipe. */
import type * as React from 'react';

import { cn } from '../../lib/utils';

type ButtonVariant = 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'link';
type ButtonSize = 'default' | 'xs' | 'sm' | 'lg' | 'icon' | 'icon-xs' | 'icon-sm' | 'icon-lg';

const baseClassName =
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[background-color,border-color,color,filter,transform] duration-200 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-45 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/30 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

const variantClassNames: Record<ButtonVariant, string> = {
  default: 'bg-primary text-primary-foreground hover:brightness-110 active:brightness-95',
  outline:
    'border-border bg-transparent hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground',
  secondary:
    'bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
  ghost: 'hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground',
  destructive:
    'bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40',
  link: 'text-primary underline-offset-4 hover:underline',
};

const sizeClassNames: Record<ButtonSize, string> = {
  default: 'h-10 gap-1.5 px-4',
  xs: 'h-7 gap-1 rounded-md px-2 text-xs [&_svg:not([class*=size-])]:size-3',
  sm: 'h-9 gap-1 rounded-md px-3 text-[0.8rem] [&_svg:not([class*=size-])]:size-3.5',
  lg: 'h-11 gap-2 px-5',
  icon: 'size-10',
  'icon-xs': 'size-6 rounded-md [&_svg:not([class*=size-])]:size-3',
  'icon-sm': 'size-8 rounded-md',
  'icon-lg': 'size-11',
};

type ButtonVariantOptions = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
};

function buttonVariants({
  variant = 'default',
  size = 'default',
  className,
}: ButtonVariantOptions = {}) {
  return cn(baseClassName, variantClassNames[variant], sizeClassNames[size], className);
}

type ButtonProps = React.ComponentProps<'button'> & ButtonVariantOptions;

function Button({ className, variant = 'default', size = 'default', type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      data-slot="button"
      className={buttonVariants({ variant, size, className })}
      {...props}
    />
  );
}

export { Button, buttonVariants };
export type { ButtonProps, ButtonSize, ButtonVariant };
