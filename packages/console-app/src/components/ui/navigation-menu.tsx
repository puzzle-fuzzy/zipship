import { cva } from 'class-variance-authority';
import { ChevronDownIcon } from 'lucide-react';
import { NavigationMenu as NavigationMenuPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

function NavigationMenu({
  className,
  children,
  viewport = true,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Root> & {
  viewport?: boolean;
}) {
  return (
    <NavigationMenuPrimitive.Root
      data-slot="navigation-menu"
      data-viewport={viewport}
      className={cn(
        'group/navigation-menu relative flex max-w-max flex-1 items-center justify-center',
        className,
      )}
      {...props}
    >
      {children}
      {viewport && <NavigationMenuViewport />}
    </NavigationMenuPrimitive.Root>
  );
}

function NavigationMenuList({
  className,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.List>) {
  return (
    <NavigationMenuPrimitive.List
      data-slot="navigation-menu-list"
      className={cn(
        'group flex flex-1 list-none items-center justify-center gap-1',
        className,
      )}
      {...props}
    />
  );
}

const navigationMenuItemVariants = cva(
  'group relative inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 data-active:bg-accent/50 data-[state=open]:bg-accent/50 data-disabled:pointer-events-none data-disabled:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0',
);

function NavigationMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Item>) {
  return (
    <NavigationMenuPrimitive.Item
      data-slot="navigation-menu-item"
      className={cn(navigationMenuItemVariants(), className)}
      {...props}
    />
  );
}

function NavigationMenuTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Trigger>) {
  return (
    <NavigationMenuPrimitive.Trigger
      data-slot="navigation-menu-trigger"
      className={cn('group', className)}
      {...props}
    >
      {children}
      <ChevronDownIcon
        className="relative top-px ml-1 size-3 transition duration-200 group-data-[state=open]:rotate-180"
        aria-hidden="true"
      />
    </NavigationMenuPrimitive.Trigger>
  );
}

function NavigationMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Content>) {
  return (
    <NavigationMenuPrimitive.Content
      data-slot="navigation-menu-content"
      className={cn(
        'left-0 top-0 w-full data-[motion^=from-]:animate-in data-[motion^=from-]:fade-in data-[motion^=to-]:animate-out data-[motion^=to-]:fade-out data-[motion=from-start]:slide-in-from-right-52 data-[motion=from-end]:slide-in-from-left-52 data-[motion=to-start]:slide-out-to-right-52 data-[motion=to-end]:slide-out-to-left-52 md:absolute md:w-auto',
        className,
      )}
      {...props}
    />
  );
}

function NavigationMenuViewport({
  className,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Viewport>) {
  return (
    <div className="absolute top-full left-0 flex justify-center">
      <NavigationMenuPrimitive.Viewport
        data-slot="navigation-menu-viewport"
        className={cn(
          'origin-top-center relative mt-1.5 h-[var(--radix-navigation-menu-viewport-height)] w-full overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10 data-[state=open]:animate-in data-[state=open]:zoom-in-90 data-[state=open]:fade-in data-[state=closed]:animate-out data-[state=closed]:zoom-out-90 data-[state=closed]:fade-out md:w-[var(--radix-navigation-menu-viewport-width)]',
          className,
        )}
        {...props}
      />
    </div>
  );
}

function NavigationMenuLink({
  className,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Link>) {
  return (
    <NavigationMenuPrimitive.Link
      data-slot="navigation-menu-link"
      className={cn(
        'flex h-7 w-full items-center justify-start gap-1.5 rounded-md px-1.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground data-active:bg-accent/50',
        className,
      )}
      {...props}
    />
  );
}

function NavigationMenuIndicator({
  className,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Indicator>) {
  return (
    <NavigationMenuPrimitive.Indicator
      data-slot="navigation-menu-indicator"
      className={cn(
        'top-full z-1 flex items-end justify-center overflow-hidden data-[state=visible]:animate-in data-[state=visible]:fade-in data-[state=hidden]:animate-out data-[state=hidden]:fade-out',
        className,
      )}
      {...props}
    >
      <div className="relative top-[60%] h-2 w-2 rotate-45 rounded-tl-sm bg-popover shadow-md ring-1 ring-foreground/10" />
    </NavigationMenuPrimitive.Indicator>
  );
}

export {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuIndicator,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  NavigationMenuViewport,
};
