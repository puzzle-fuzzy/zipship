import { createContext, useContext, useId, useState } from 'react';
import type * as React from 'react';

import { cn } from '../../lib/utils';

type TabsContextValue = {
  baseId: string;
  onValueChange: (value: string) => void;
  orientation: 'horizontal' | 'vertical';
  value: string;
};

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext() {
  const context = useContext(TabsContext);
  if (!context) throw new Error('Tabs components must be rendered inside Tabs.');
  return context;
}

function safeId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}

type TabsProps = React.ComponentProps<'div'> & {
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  orientation?: 'horizontal' | 'vertical';
  value?: string;
};

function Tabs({ className, defaultValue = '', onValueChange, orientation = 'horizontal', value: controlledValue, ...props }: TabsProps) {
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
  const value = controlledValue ?? uncontrolledValue;
  const baseId = useId();
  const handleValueChange = (nextValue: string) => {
    if (controlledValue === undefined) setUncontrolledValue(nextValue);
    onValueChange?.(nextValue);
  };

  return (
    <TabsContext.Provider value={{ baseId, onValueChange: handleValueChange, orientation, value }}>
      <div data-slot="tabs" data-orientation={orientation} className={cn('group/tabs flex gap-2 data-[orientation=horizontal]:flex-col', className)} {...props} />
    </TabsContext.Provider>
  );
}

function TabsList({ className, variant = 'default', onKeyDown, ...props }: React.ComponentProps<'div'> & { variant?: 'default' | 'line' }) {
  const { orientation } = useTabsContext();
  return (
    <div
      role="tablist"
      aria-orientation={orientation}
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(
        'group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground data-[variant=line]:rounded-none data-[variant=default]:bg-muted data-[variant=line]:gap-1 data-[variant=line]:bg-transparent',
        orientation === 'vertical' && 'h-fit flex-col',
        orientation === 'horizontal' && 'h-8',
        className,
      )}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]:not(:disabled)')];
        const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
        const previousKey = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
        const nextKey = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
        let nextIndex: number | null = null;
        if (event.key === previousKey) nextIndex = (index - 1 + tabs.length) % tabs.length;
        if (event.key === nextKey) nextIndex = (index + 1) % tabs.length;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = tabs.length - 1;
        if (nextIndex !== null) {
          event.preventDefault();
          tabs[nextIndex]?.focus();
          tabs[nextIndex]?.click();
        }
      }}
      {...props}
    />
  );
}

function TabsTrigger({ className, value, onClick, ...props }: React.ComponentProps<'button'> & { value: string }) {
  const { baseId, onValueChange, orientation, value: selectedValue } = useTabsContext();
  const active = selectedValue === value;
  const idValue = safeId(value);
  return (
    <button
      type="button"
      role="tab"
      id={`${baseId}-tab-${idValue}`}
      aria-controls={`${baseId}-panel-${idValue}`}
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      data-slot="tabs-trigger"
      data-active={active ? '' : undefined}
      className={cn(
        'relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-active:bg-background data-active:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-sm',
        orientation === 'vertical' && 'w-full justify-start',
        'after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-[variant=line]/tabs-list:data-active:bg-transparent group-data-[variant=line]/tabs-list:data-active:after:opacity-100 group-data-[variant=line]/tabs-list:after:inset-x-0 group-data-[variant=line]/tabs-list:after:-bottom-1.25 group-data-[variant=line]/tabs-list:after:h-0.5',
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onValueChange(value);
      }}
      {...props}
    />
  );
}

function TabsContent({ className, value, ...props }: React.ComponentProps<'div'> & { value: string }) {
  const { baseId, value: selectedValue } = useTabsContext();
  const idValue = safeId(value);
  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${idValue}`}
      aria-labelledby={`${baseId}-tab-${idValue}`}
      hidden={selectedValue !== value}
      tabIndex={0}
      data-slot="tabs-content"
      className={cn('flex-1 text-sm outline-none', className)}
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
