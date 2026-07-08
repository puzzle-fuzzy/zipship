import { Box, Database, LayoutGrid, ScrollText } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { NavLink, useLocation } from 'react-router';
import { useTranslation } from '../../i18n';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '../../components/ui/sidebar';

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
    <Sidebar collapsible="none" className="hidden md:flex p-2">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            {/* Brand */}
            <SidebarMenu>
              <SidebarMenuItem className="flex items-center gap-2 px-2 pb-6 pt-4">
                <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  <Box className="size-4" />
                </div>
                <span className="text-sm font-semibold">{t('app.name')}</span>
              </SidebarMenuItem>
            </SidebarMenu>

            {/* Primary nav */}
            <SidebarMenu className="gap-1">
              {NAV_ITEMS.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    render={<NavLink to={item.to} />}
                    isActive={isActive(item.to)}
                  >
                    <item.icon />
                    <span>{t(item.labelKey)}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
