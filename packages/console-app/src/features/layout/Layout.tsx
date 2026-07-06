import { IconBook, IconLogout, IconPlus, IconSettings } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { useTranslation } from '../../i18n';
import { Avatar } from '../../shared/ui/Avatar';
import { Dropdown } from '../../shared/ui/Dropdown';
import styles from './Layout.module.css';

interface Project {
  id: string;
  name: string;
  slug: string;
  currentReleaseId: string | null;
}

interface LayoutProps {
  user: { id: string; name: string; email: string };
  projects: Project[];
  selectedProjectId: string | null;
  onSelectProject: (project: Project | null) => void;
  onCreateProject: () => void;
  onLogout: () => void;
  onOpenSettings: () => void;
  onHelp?: () => void;
  children: ReactNode;
}

export function Layout({
  user,
  projects,
  selectedProjectId,
  onSelectProject,
  onCreateProject,
  onLogout,
  onOpenSettings,
  onHelp,
  children,
}: LayoutProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.wrapper}>
      {/* ─── Sidebar ─── */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarSection}>
          <button
            type="button"
            className={`${styles.sidebarBtn}${!selectedProjectId ? ` ${styles.sidebarBtnActive}` : ''}`}
            onClick={() => onSelectProject(null)}
          >
            <IconBook size={16} className={styles.sidebarBtnIcon} />
            <span>{t('app.projects')}</span>
          </button>
        </div>

        <div className={styles.sidebarSection}>
          <span className={styles.sidebarLabel}>{t('app.projects')}</span>
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              className={`${styles.sidebarBtn}${selectedProjectId === project.id ? ` ${styles.sidebarBtnActive}` : ''}`}
              onClick={() => onSelectProject(project)}
            >
              <span className={styles.sidebarBtnName}>{project.name}</span>
            </button>
          ))}
        </div>

        <button type="button" className={styles.newBtn} onClick={onCreateProject}>
          <IconPlus size={14} />
          {t('app.newProject')}
        </button>
      </aside>

      {/* ─── Main: Header + Content ─── */}
      <div className={styles.main}>
        <header className={styles.header}>
          <Dropdown
            upward
            trigger={
              <div className={styles.userArea}>
                <div className={styles.userInfo}>
                  <div className={styles.userName}>{user.name}</div>
                  <div className={styles.userEmail}>{user.email}</div>
                </div>
                <Avatar name={user.name} size="sm" />
              </div>
            }
            items={[
              { label: t('app.settings'), icon: <IconSettings size={16} />, onClick: onOpenSettings },
              ...(onHelp ? [{ label: t('help.title'), icon: <IconBook size={16} />, onClick: onHelp } as const] : []),
              { divider: true },
              { label: t('app.signOut'), icon: <IconLogout size={16} />, danger: true, onClick: onLogout },
            ]}
          />
        </header>

        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}
