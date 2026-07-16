import { Link } from 'react-router';
import { MaterialIcon } from '../../components/MaterialIcon';
import { AvatarDropdown } from '../../components/primitives/avatar-dropdown';
import { useTranslation } from '../../i18n';

interface AppHeaderProps {
  user: { id: string; name: string; email: string };
  onLogout: () => void;
  onOpenSettings?: () => void;
  onOpenProfile?: () => void;
}

export function AppHeader({
  user,
  onLogout,
  onOpenSettings,
  onOpenProfile,
}: AppHeaderProps) {
  const { t } = useTranslation();

  return (
    <header className="sticky top-0 z-30 border-b bg-background">
      <div className="mx-auto flex h-16 w-full max-w-[67.5rem] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link
          to="/app/projects"
          className="group flex min-h-11 items-center gap-2.5 rounded-lg pr-3 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-[filter] duration-200 group-hover:brightness-110">
            <MaterialIcon name="deployed_code" className="text-[18px]" />
          </span>
          <span className="text-[15px] font-semibold tracking-[-0.01em]">{t('app.name')}</span>
        </Link>

        <div className="flex items-center">
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
