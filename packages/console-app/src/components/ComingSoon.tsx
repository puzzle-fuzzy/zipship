import type { LucideIcon } from 'lucide-react';
import { useTranslation } from '../i18n';

interface ComingSoonProps {
  /** Lucide icon shown in the muted tile. */
  icon: LucideIcon;
  /** Translated page title. */
  title: string;
  /** Translated description / "coming soon" copy. */
  description: string;
}

/**
 * Centered empty-state used by not-yet-built top-level pages (Logs, Storage).
 * Keeps the placeholder UI in one place so every scaffolded page looks consistent.
 */
export function ComingSoon({ icon: Icon, title, description }: ComingSoonProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <div className="flex size-12 items-center justify-center rounded-lg bg-muted">
        <Icon className="size-6 text-muted-foreground" />
      </div>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <span className="rounded-full border px-3 py-1 text-xs text-muted-foreground">
        {t('common.comingSoon')}
      </span>
    </div>
  );
}
