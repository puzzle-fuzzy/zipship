import { AvatarDropdown } from '../../components/ui/avatar-dropdown';

interface AppHeaderProps {
  user: { id: string; name: string; email: string };
  onLogout: () => void;
  onOpenSettings?: () => void;
  onOpenProfile?: () => void;
}

export function AppHeader({ user, onLogout, onOpenSettings, onOpenProfile }: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center justify-end bg-background/95 px-4 transition-[width,height] ease-linear">
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
