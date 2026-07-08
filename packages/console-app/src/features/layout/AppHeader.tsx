import { Plus } from 'lucide-react';
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
    <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center justify-between gap-4 bg-background/95 px-4 transition-[width,height] ease-linear">
      <Button variant="outline" onClick={onNewProject}>
        <Plus className="size-4" />
        {t('app.newProject')}
      </Button>
      <div className="flex items-center">
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
