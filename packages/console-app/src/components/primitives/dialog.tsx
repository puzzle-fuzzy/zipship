import { XIcon } from 'lucide-react';
import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import type * as React from 'react';

import { cn } from '../../lib/utils';
import { Button } from './button';

type DialogContextValue = {
  descriptionId: string;
  open: boolean;
  setOpen: (open: boolean) => void;
  titleId: string;
};

const DialogContext = createContext<DialogContextValue | null>(null);

function useDialogContext() {
  const context = useContext(DialogContext);
  if (!context) throw new Error('Dialog components must be rendered inside Dialog.');
  return context;
}

type DialogProps = {
  children: React.ReactNode;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
};

function Dialog({ children, defaultOpen = false, onOpenChange, open: controlledOpen }: DialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const baseId = useId();
  const setOpen = (nextOpen: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  return (
    <DialogContext.Provider value={{ descriptionId: `${baseId}-description`, open, setOpen, titleId: `${baseId}-title` }}>
      {children}
    </DialogContext.Provider>
  );
}

function DialogTrigger({ children, onClick, ...props }: React.ComponentProps<'button'>) {
  const { open, setOpen } = useDialogContext();
  return <button type="button" aria-haspopup="dialog" aria-expanded={open} data-slot="dialog-trigger" onClick={(event) => { onClick?.(event); if (!event.defaultPrevented) setOpen(true); }} {...props}>{children}</button>;
}

function DialogClose({ children, onClick, ...props }: React.ComponentProps<'button'>) {
  const { setOpen } = useDialogContext();
  return <button type="button" data-slot="dialog-close" onClick={(event) => { onClick?.(event); if (!event.defaultPrevented) setOpen(false); }} {...props}>{children}</button>;
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  closeLabel = 'Close',
  onCancel,
  onClick,
  ...props
}: React.ComponentProps<'dialog'> & { closeLabel?: string; showCloseButton?: boolean }) {
  const { descriptionId, open, setOpen, titleId } = useDialogContext();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      data-slot="dialog-content"
      className={cn(
        'fixed inset-0 z-50 m-auto grid w-full max-w-[calc(100%-2rem)] gap-4 rounded-xl border bg-popover p-5 text-sm text-popover-foreground outline-none backdrop:bg-black/60 sm:max-w-sm',
        className,
      )}
      onCancel={(event) => {
        onCancel?.(event);
        if (!event.defaultPrevented) setOpen(false);
      }}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented && event.target === event.currentTarget) setOpen(false);
      }}
      {...props}
    >
      {children}
      {showCloseButton ? (
        <Button aria-label={closeLabel} variant="ghost" className="absolute top-2 right-2" size="icon-sm" onClick={() => setOpen(false)}>
          <XIcon aria-hidden="true" />
          <span className="sr-only">{closeLabel}</span>
        </Button>
      ) : null}
    </dialog>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="dialog-header" className={cn('flex flex-col gap-2', className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="dialog-footer" className={cn('-mx-5 -mb-5 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-5 sm:flex-row sm:justify-end', className)} {...props} />;
}

function DialogTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  const { titleId } = useDialogContext();
  return <h2 id={titleId} data-slot="dialog-title" className={cn('font-heading text-base leading-none font-medium', className)} {...props} />;
}

function DialogDescription({ className, ...props }: React.ComponentProps<'p'>) {
  const { descriptionId } = useDialogContext();
  return <p id={descriptionId} data-slot="dialog-description" className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger };
