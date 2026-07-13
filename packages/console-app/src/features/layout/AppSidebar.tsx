import { Database, LayoutGrid, ScrollText } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { useTranslation } from '../../i18n';

interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/app/projects', labelKey: 'nav.projects', icon: LayoutGrid },
  { to: '/app/logs', labelKey: 'nav.logs', icon: ScrollText },
  { to: '/app/storage', labelKey: 'nav.storage', icon: Database },
];

export function AppSidebar() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const isActive = (to: string) => pathname === to || pathname.startsWith(`${to}/`);

  return (
    <aside className="hidden w-56 shrink-0 lg:block">
      <nav className="rounded-lg border bg-card p-2" aria-label={t('app.name')}>
        <div className="px-3 pb-3 pt-2 text-sm font-semibold">{t('app.name')}</div>
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            aria-current={isActive(item.to) ? 'page' : undefined}
            className={[
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
              isActive(item.to)
                ? 'bg-accent font-medium text-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            ].join(' ')}
          >
            <item.icon className="size-4" />
            {t(item.labelKey)}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
