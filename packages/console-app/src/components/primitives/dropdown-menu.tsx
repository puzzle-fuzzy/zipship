import { cloneElement, createContext, isValidElement, useContext, useEffect, useRef, useState } from 'react';
import type * as React from 'react';

import { cn } from '../../lib/utils';

type DropdownMenuContextValue = {
  close: () => void;
  open: boolean;
  rootRef: React.RefObject<HTMLDivElement | null>;
  setOpen: (open: boolean) => void;
};

const DropdownMenuContext = createContext<DropdownMenuContextValue | null>(null);

function useDropdownMenuContext() {
  const context = useContext(DropdownMenuContext);
  if (!context) throw new Error('DropdownMenu components must be rendered inside DropdownMenu.');
  return context;
}

function DropdownMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  return (
    <DropdownMenuContext.Provider value={{ close: () => setOpen(false), open, rootRef, setOpen }}>
      <div ref={rootRef} data-slot="dropdown-menu" className="relative inline-flex">{children}</div>
    </DropdownMenuContext.Provider>
  );
}

type TriggerElementProps = {
  'aria-expanded'?: boolean;
  'aria-haspopup'?: 'menu';
  children?: React.ReactNode;
  onClick?: React.MouseEventHandler;
  onKeyDown?: React.KeyboardEventHandler;
};

function DropdownMenuTrigger({ children, render }: { children?: React.ReactNode; render?: React.ReactElement<TriggerElementProps> }) {
  const { open, rootRef, setOpen } = useDropdownMenuContext();
  const triggerProps: TriggerElementProps = {
    'aria-expanded': open,
    'aria-haspopup': 'menu',
    children,
    onClick: (event) => {
      render?.props.onClick?.(event);
      if (!event.defaultPrevented) setOpen(!open);
    },
    onKeyDown: (event) => {
      render?.props.onKeyDown?.(event);
      if (!event.defaultPrevented && (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        setOpen(true);
        queueMicrotask(() => rootRef.current?.querySelector<HTMLElement>('[role=menuitem]:not(:disabled)')?.focus());
      }
    },
  };

  if (render && isValidElement(render)) return cloneElement(render, triggerProps);
  return <button type="button" data-slot="dropdown-menu-trigger" {...triggerProps} />;
}

function DropdownMenuContent({ align = 'start', className, children, onKeyDown, sideOffset: _sideOffset, ...props }: React.ComponentProps<'div'> & { align?: 'start' | 'center' | 'end'; sideOffset?: number }) {
  const { close, open, rootRef } = useDropdownMenuContext();
  if (!open) return null;

  return (
    <div
      role="menu"
      data-slot="dropdown-menu-content"
      data-align={align}
      className={cn(
        'absolute top-full z-50 mt-1 min-w-32 overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground outline-none data-[align=start]:left-0 data-[align=end]:right-0 data-[align=center]:left-1/2 data-[align=center]:-translate-x-1/2',
        className,
      )}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role=menuitem]:not(:disabled)')];
        const index = items.indexOf(document.activeElement as HTMLElement);
        if (event.key === 'Escape') {
          close();
          rootRef.current?.querySelector<HTMLElement>('[aria-haspopup=menu]')?.focus();
        } else if (event.key === 'ArrowDown') {
          event.preventDefault();
          items[(index + 1) % items.length]?.focus();
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          items[(index - 1 + items.length) % items.length]?.focus();
        }
      }}
      {...props}
    >
      {children}
    </div>
  );
}

function DropdownMenuItem({ className, variant = 'default', disabled, onClick, type = 'button', ...props }: React.ComponentProps<'button'> & { variant?: 'default' | 'destructive' }) {
  const { close } = useDropdownMenuContext();
  return (
    <button
      type={type}
      role="menuitem"
      disabled={disabled}
      data-slot="dropdown-menu-item"
      data-variant={variant}
      className={cn('flex min-h-9 w-full cursor-default items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm outline-none select-none hover:bg-accent focus:bg-accent focus:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 data-[variant=destructive]:text-destructive data-[variant=destructive]:hover:bg-destructive/10 data-[variant=destructive]:focus:bg-destructive/10', className)}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) close();
      }}
      {...props}
    />
  );
}

function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<'div'>) {
  return <div role="separator" data-slot="dropdown-menu-separator" className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
}

export { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger };
