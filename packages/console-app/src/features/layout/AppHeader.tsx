import { Plus } from 'lucide-react';
import { AvatarDropdown } from '../../components/primitives/avatar-dropdown';
import { Button } from '../../components/primitives/button';
import { useTranslation } from '../../i18n';

interface AppHeaderProps {
  user: { id: string; name: string; email: string };
  onNewProject: () => void;
  onLogout: () => void;
  onOpenSettings?: () => void;
  onOpenProfile?: () => void;
}

export function AppHeader({
  user,
  onNewProject,
  onLogout,
  onOpenSettings,
  onOpenProfile,
}: AppHeaderProps) {
  const { t } = useTranslation();

  return (
    <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <div className="text-lg font-semibold tracking-tight">{t('app.name')}</div>
          <nav className="hidden items-center gap-1 text-sm text-muted-foreground md:flex">
            <a href="/app/projects" className="rounded-md px-3 py-2 hover:bg-accent hover:text-foreground">
              {t('nav.projects')}
            </a>
            <a href="/app/logs" className="rounded-md px-3 py-2 hover:bg-accent hover:text-foreground">
              {t('nav.logs')}
            </a>
            <a href="/app/storage" className="rounded-md px-3 py-2 hover:bg-accent hover:text-foreground">
              {t('nav.storage')}
            </a>
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={onNewProject} size="sm">
            <Plus className="size-4" />
            {t('app.newProject')}
          </Button>
          <AvatarDropdown
            user={user}
            onLogout={onLogout}
            onOpenSettings={onOpenSettings}
            onOpenProfile={onOpenProfile}
          />
        </div>
      </div>
    </header>
  );
}
