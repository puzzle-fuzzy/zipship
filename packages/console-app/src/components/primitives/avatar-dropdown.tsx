import { LogOut, Moon, Settings, Sun, User } from 'lucide-react';

import { useTranslation } from '../../i18n';
import { useSettingsStore } from '../../stores/settingsStore';
import { Avatar, AvatarFallback } from './avatar';
import { Button } from './button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './dropdown-menu';

interface AvatarDropdownProps {
  user: { id: string; name: string; email: string };
  onLogout: () => void;
  onOpenSettings?: () => void;
  onOpenProfile?: () => void;
}

function getUserInitials(name: string): string {
  return name.split(' ').map((part) => part[0]).join('').toUpperCase().slice(0, 2);
}

export function AvatarDropdown({ user, onLogout, onOpenSettings, onOpenProfile }: AvatarDropdownProps) {
  const { t, language } = useTranslation();
  const { theme, setTheme, setLanguage } = useSettingsStore();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="rounded-full" />}>
        <Avatar>
          <AvatarFallback>{getUserInitials(user.name)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-1.5 py-1.5">
          <p className="text-sm font-medium">{user.name}</p>
          <p className="text-xs text-muted-foreground">{user.email}</p>
        </div>
        <DropdownMenuSeparator />

        {onOpenProfile ? (
          <DropdownMenuItem onClick={onOpenProfile}>
            <User className="size-4" />
            Edit Profile
          </DropdownMenuItem>
        ) : null}

        <DropdownMenuItem onClick={() => setTheme(theme === 'day' ? 'night' : 'day')}>
          {theme === 'day' ? <Moon className="size-4" /> : <Sun className="size-4" />}
          {theme === 'day' ? t('settings.night') : t('settings.day')}
        </DropdownMenuItem>

        <DropdownMenuItem onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')}>
          <span className="flex size-4 items-center justify-center text-xs font-medium">
            {language === 'zh' ? 'EN' : '中'}
          </span>
          {language === 'zh' ? t('settings.en') : t('settings.zh')}
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        {onOpenSettings ? (
          <DropdownMenuItem onClick={onOpenSettings}>
            <Settings className="size-4" />
            {t('app.settings')}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onClick={onLogout} variant="destructive">
          <LogOut className="size-4" />
          {t('app.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
