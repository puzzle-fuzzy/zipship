import { IconBook, IconLogout, IconRocket, IconSettings } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { useTranslation } from '../../i18n';
import { Avatar } from '../../shared/ui/Avatar';
import { Dropdown } from '../../shared/ui/Dropdown';
import styles from './Layout.module.css';

interface LayoutProps {
  user: { id: string; name: string; email: string };
  onLogout: () => void;
  onOpenSettings: () => void;
  onHelp?: () => void;
  children: ReactNode;
  headerExtra?: ReactNode;
}

export function Layout({ user, onLogout, onOpenSettings, onHelp, children, headerExtra }: LayoutProps) {
  const { t } = useTranslation();

  return (
    <div>
      {/* ─── Header ─── */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.logo}>
            <IconRocket size={22} />
            <span className={styles.logoText}>{t('app.name')}</span>
          </div>
        </div>

        <div className={styles.headerRight}>
          {headerExtra}
          <Dropdown
            upward
            trigger={
              <div className={styles.userArea}>
                <Avatar name={user.name} size="sm" />
                <div className={styles.userInfo}>
                  <div className={styles.userName}>{user.name}</div>
                  <div className={styles.userEmail}>{user.email}</div>
                </div>
              </div>
            }
            items={[
              { label: t('app.settings'), icon: <IconSettings size={16} />, onClick: onOpenSettings },
              ...(onHelp ? [{ label: t('help.title'), icon: <IconBook size={16} />, onClick: onHelp } as const] : []),
              { divider: true },
              { label: t('app.signOut'), icon: <IconLogout size={16} />, danger: true, onClick: onLogout },
            ]}
          />
        </div>
      </header>

      {/* ─── Content ─── */}
      <div className={styles.content}>{children}</div>
    </div>
  );
}
