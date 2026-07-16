import type * as React from 'react';

import { cn } from '../../lib/utils';

type AvatarProps = React.ComponentProps<'div'> & { size?: 'default' | 'sm' | 'lg' };

function Avatar({ className, size = 'default', ...props }: AvatarProps) {
  return (
    <div
      data-slot="avatar"
      data-size={size}
      className={cn(
        'group/avatar relative flex size-8 shrink-0 overflow-hidden rounded-full select-none after:pointer-events-none after:absolute after:inset-0 after:rounded-full after:border after:border-border data-[size=lg]:size-10 data-[size=sm]:size-6',
        className,
      )}
      {...props}
    />
  );
}

function AvatarImage({ className, alt = '', ...props }: React.ComponentProps<'img'>) {
  return <img data-slot="avatar-image" className={cn('aspect-square size-full rounded-full object-cover', className)} alt={alt} {...props} />;
}

function AvatarFallback({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="avatar-fallback" className={cn('flex size-full items-center justify-center rounded-full bg-muted text-sm text-muted-foreground group-data-[size=sm]/avatar:text-xs', className)} {...props} />;
}

function AvatarBadge({ className, ...props }: React.ComponentProps<'span'>) {
  return <span data-slot="avatar-badge" className={cn('absolute right-0 bottom-0 z-10 inline-flex size-2.5 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background', className)} {...props} />;
}

function AvatarGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="avatar-group" className={cn('flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background', className)} {...props} />;
}

function AvatarGroupCount({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="avatar-group-count" className={cn('relative flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm text-muted-foreground ring-2 ring-background', className)} {...props} />;
}

export { Avatar, AvatarBadge, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage };
