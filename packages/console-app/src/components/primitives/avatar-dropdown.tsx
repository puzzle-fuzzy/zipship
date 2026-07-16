import { MaterialIcon } from '../MaterialIcon';
import { useTranslation } from '../../i18n';
import { useSettingsStore } from '../../stores/settingsStore';
import { Avatar, AvatarFallback } from './avatar';
import { Button } from './button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu';

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
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="size-10 rounded-full" />}>
        <Avatar>
          <AvatarFallback>{getUserInitials(user.name)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2.5 py-2">
          <p className="text-sm font-medium">{user.name}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{user.email}</p>
        </div>
        <DropdownMenuSeparator />

        {onOpenProfile ? (
          <DropdownMenuItem onClick={onOpenProfile}>
            <MaterialIcon name="person" className="text-[18px]" />
            {t('app.profile')}
          </DropdownMenuItem>
        ) : null}

        <DropdownMenuItem onClick={() => setTheme(theme === 'day' ? 'night' : 'day')}>
          <MaterialIcon name={theme === 'day' ? 'dark_mode' : 'light_mode'} className="text-[18px]" />
          {theme === 'day' ? t('settings.night') : t('settings.day')}
        </DropdownMenuItem>

        <DropdownMenuItem onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')}>
          <span className="flex size-[18px] items-center justify-center text-xs font-medium">
            {language === 'zh' ? 'EN' : '中'}
          </span>
          {language === 'zh' ? t('settings.en') : t('settings.zh')}
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        {onOpenSettings ? (
          <DropdownMenuItem onClick={onOpenSettings}>
            <MaterialIcon name="settings" className="text-[18px]" />
            {t('app.settings')}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onClick={onLogout} variant="destructive">
          <MaterialIcon name="logout" className="text-[18px]" />
          {t('app.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
