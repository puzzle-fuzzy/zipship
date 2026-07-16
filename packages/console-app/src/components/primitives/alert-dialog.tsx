import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import type * as React from 'react';

import { cn } from '../../lib/utils';
import { buttonVariants, type ButtonVariant } from './button';

type AlertDialogContextValue = {
  descriptionId: string;
  open: boolean;
  setOpen: (open: boolean) => void;
  titleId: string;
};

const AlertDialogContext = createContext<AlertDialogContextValue | null>(null);

function useAlertDialogContext() {
  const context = useContext(AlertDialogContext);
  if (!context) throw new Error('AlertDialog components must be rendered inside AlertDialog.');
  return context;
}

type AlertDialogProps = {
  children: React.ReactNode;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
};

function AlertDialog({ children, defaultOpen = false, onOpenChange, open: controlledOpen }: AlertDialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const baseId = useId();
  const setOpen = (nextOpen: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  return (
    <AlertDialogContext.Provider value={{ descriptionId: `${baseId}-description`, open, setOpen, titleId: `${baseId}-title` }}>
      {children}
    </AlertDialogContext.Provider>
  );
}

function AlertDialogContent({ className, children, size = 'default', onCancel, ...props }: React.ComponentProps<'dialog'> & { size?: 'default' | 'sm' }) {
  const { descriptionId, open, setOpen, titleId } = useAlertDialogContext();
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
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      data-slot="alert-dialog-content"
      data-size={size}
      className={cn(
        'fixed inset-0 z-50 m-auto grid w-full max-w-[calc(100%-2rem)] gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground shadow-xl ring-1 ring-foreground/10 outline-none backdrop:bg-black/20 backdrop:backdrop-blur-xs sm:max-w-sm data-[size=sm]:sm:max-w-xs',
        className,
      )}
      onCancel={(event) => {
        onCancel?.(event);
        if (!event.defaultPrevented) setOpen(false);
      }}
      {...props}
    >
      {children}
    </dialog>
  );
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="alert-dialog-header" className={cn('flex flex-col gap-2 text-center sm:text-left', className)} {...props} />;
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="alert-dialog-footer" className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />;
}

function AlertDialogTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  const { titleId } = useAlertDialogContext();
  return <h2 id={titleId} data-slot="alert-dialog-title" className={cn('font-heading text-base leading-none font-medium', className)} {...props} />;
}

function AlertDialogDescription({ className, ...props }: React.ComponentProps<'p'>) {
  const { descriptionId } = useAlertDialogContext();
  return <p id={descriptionId} data-slot="alert-dialog-description" className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

type AlertDialogButtonProps = React.ComponentProps<'button'> & { variant?: ButtonVariant };

function AlertDialogAction({ className, variant = 'default', onClick, type = 'button', ...props }: AlertDialogButtonProps) {
  const { setOpen } = useAlertDialogContext();
  return (
    <button
      type={type}
      data-slot="alert-dialog-action"
      className={buttonVariants({ variant, className })}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) setOpen(false);
      }}
      {...props}
    />
  );
}

function AlertDialogCancel({ className, onClick, type = 'button', ...props }: React.ComponentProps<'button'>) {
  const { setOpen } = useAlertDialogContext();
  return (
    <button
      type={type}
      data-slot="alert-dialog-cancel"
      className={buttonVariants({ variant: 'outline', className })}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) setOpen(false);
      }}
      {...props}
    />
  );
}

export { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle };
