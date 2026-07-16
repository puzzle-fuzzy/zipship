import { CircleCheckIcon, InfoIcon, OctagonXIcon, TriangleAlertIcon, XIcon } from 'lucide-react';
import { useSyncExternalStore } from 'react';

import { useTranslation } from '../../i18n';
import { getToastSnapshot, subscribeToToasts, toast, type ToastKind } from '../../lib/toast';
import { cn } from '../../lib/utils';

const iconByKind = {
  error: OctagonXIcon,
  info: InfoIcon,
  success: CircleCheckIcon,
  warning: TriangleAlertIcon,
} satisfies Record<ToastKind, typeof InfoIcon>;

const colorByKind: Record<ToastKind, string> = {
  error: 'text-destructive',
  info: 'text-primary',
  success: 'text-emerald-600 dark:text-emerald-400',
  warning: 'text-amber-600 dark:text-amber-400',
};

function Toaster() {
  const { t } = useTranslation();
  const entries = useSyncExternalStore(subscribeToToasts, getToastSnapshot, getToastSnapshot);

  if (entries.length === 0) return null;

  return (
    <div aria-live="polite" aria-atomic="false" className="pointer-events-none fixed top-4 right-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
      {entries.map((entry) => {
        const Icon = iconByKind[entry.kind];
        return (
          <div
            key={entry.id}
            role={entry.kind === 'error' ? 'alert' : 'status'}
            className="pointer-events-auto grid grid-cols-[auto_1fr_auto] items-start gap-2 rounded-xl border bg-popover p-3 text-sm text-popover-foreground shadow-lg motion-safe:[animation:toast-in_180ms_ease-out]"
          >
            <Icon aria-hidden="true" className={cn('mt-0.5 size-4', colorByKind[entry.kind])} />
            <div className="min-w-0 leading-5 text-balance">{entry.message}</div>
            <button
              type="button"
              aria-label={t('common.close')}
              className="-mt-1 -mr-1 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              onClick={() => toast.dismiss(entry.id)}
            >
              <XIcon aria-hidden="true" className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export { Toaster };
