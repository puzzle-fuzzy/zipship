import { ChevronDown, Plus } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { AvatarDropdown } from '../../components/ui/avatar-dropdown';
import { Button } from '../../components/ui/button';

interface AppHeaderProps {
  user: { id: string; name: string; email: string };
  onNewProject: () => void;
  onLogout: () => void;
  onOpenSettings?: () => void;
  onOpenProfile?: () => void;
}

export function AppHeader({ user, onNewProject, onLogout, onOpenSettings, onOpenProfile }: AppHeaderProps) {
  const { t } = useTranslation();
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-4 border-b-2 border-foreground bg-background px-4 sm:px-6">
      <div className="zip-wordmark text-xl leading-none tracking-[-0.03em]">
        {t('app.name')}
      </div>
      <div className="flex items-center gap-3">
        <nav className="hidden items-center gap-5 text-sm font-black lg:flex">
          <button type="button" className="inline-flex items-center gap-1">
            {t('nav.projects')} <ChevronDown className="size-3.5" />
          </button>
          <span>{t('versions.title')}</span>
          <span>{t('deployments.title')}</span>
          <span>{t('settings.title')}</span>
        </nav>
        <Button onClick={onNewProject} size="sm" className="bg-accent text-accent-foreground hover:bg-accent/90">
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
    </header>
  );
}
