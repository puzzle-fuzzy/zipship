import { Code2, Database, Eye, LayoutGrid, ScrollText, Settings } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { NavLink, useLocation } from 'react-router';
import { useTranslation } from '../../i18n';

interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
}

/** Top-level navigation: the sidebar is a pure menu (no project list). */
const NAV_ITEMS: NavItem[] = [
  { to: '/app/projects', labelKey: 'nav.projects', icon: LayoutGrid },
  { to: '/app/logs', labelKey: 'nav.logs', icon: ScrollText },
  { to: '/app/storage', labelKey: 'nav.storage', icon: Database },
];

export function AppSidebar() {
  const { t } = useTranslation();
  const { pathname } = useLocation();

  // A route is active when we're on it or a child of it (e.g. a project detail
  // under /app/projects).
  const isActive = (to: string) => pathname === to || pathname.startsWith(`${to}/`);

  return (
    <nav className="zip-rail" aria-label={t('app.name')}>
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          data-active={isActive(item.to)}
          className="zip-rail-item"
          title={t(item.labelKey)}
        >
          <item.icon className="size-4" />
        </NavLink>
      ))}
      <span className="my-1 h-px w-full bg-foreground/25" />
      <span className="zip-rail-item opacity-45"><Eye className="size-4" /></span>
      <span className="zip-rail-item opacity-45"><Code2 className="size-4" /></span>
      <span className="zip-rail-item opacity-45"><Settings className="size-4" /></span>
    </nav>
  );
}
