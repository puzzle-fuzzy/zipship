import type * as React from 'react';

import { cn } from '../../lib/utils';
import { Separator } from './separator';

function ItemGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <div role="list" data-slot="item-group" className={cn('flex w-full flex-col gap-4', className)} {...props} />;
}

function ItemSeparator({ className, ...props }: React.ComponentProps<typeof Separator>) {
  return <Separator data-slot="item-separator" className={cn('my-2', className)} {...props} />;
}

type ItemProps = React.ComponentProps<'div'> & {
  variant?: 'default' | 'outline' | 'muted';
  size?: 'default' | 'sm' | 'xs';
};

function Item({ className, variant = 'default', size = 'default', ...props }: ItemProps) {
  return (
    <div
      role="listitem"
      data-slot="item"
      data-variant={variant}
      data-size={size}
      className={cn(
        'group/item flex w-full flex-wrap items-center rounded-lg border text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
        variant === 'default' && 'border-transparent',
        variant === 'outline' && 'border-border',
        variant === 'muted' && 'border-transparent bg-muted/50',
        size === 'xs' ? 'gap-2 px-2.5 py-2' : 'gap-2.5 px-3 py-2.5',
        className,
      )}
      {...props}
    />
  );
}

function ItemMedia({ className, variant = 'default', ...props }: React.ComponentProps<'div'> & { variant?: 'default' | 'icon' | 'image' }) {
  return <div data-slot="item-media" data-variant={variant} className={cn('flex shrink-0 items-center justify-center gap-2', variant === 'icon' && '[&_svg:not([class*=size-])]:size-4', variant === 'image' && 'size-10 overflow-hidden rounded-sm [&_img]:size-full [&_img]:object-cover', className)} {...props} />;
}

function ItemContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="item-content" className={cn('flex flex-1 flex-col gap-1', className)} {...props} />;
}

function ItemTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="item-title" className={cn('line-clamp-1 flex w-fit items-center gap-2 text-sm leading-snug font-medium', className)} {...props} />;
}

function ItemDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return <p data-slot="item-description" className={cn('line-clamp-2 text-left text-sm leading-normal font-normal text-muted-foreground', className)} {...props} />;
}

function ItemActions({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="item-actions" className={cn('flex items-center gap-2', className)} {...props} />;
}

function ItemHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="item-header" className={cn('flex basis-full items-center justify-between gap-2', className)} {...props} />;
}

function ItemFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="item-footer" className={cn('flex basis-full items-center justify-between gap-2', className)} {...props} />;
}

export { Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemGroup, ItemHeader, ItemMedia, ItemSeparator, ItemTitle };
