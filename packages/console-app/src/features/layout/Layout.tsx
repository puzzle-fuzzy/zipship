import {
  IconBox,
  IconChevronUp,
  IconLogout,
  IconPlus,
  IconRocket,
  IconSettings,
  IconUser,
} from '@tabler/icons-react';
import type { ReactNode } from 'react';
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
  children: ReactNode;
  headerExtra?: ReactNode;
}

export function Layout({
  user,
  projects,
  selectedProjectId,
  onSelectProject,
  onCreateProject,
  onLogout,
  children,
  headerExtra,
}: LayoutProps) {
  return (
    <div className={styles.layout}>
      {/* ─── Sidebar ─── */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <IconRocket size={22} className={styles.sidebarLogo} />
          <span className={styles.sidebarTitle}>ZipShip</span>
        </div>

        <div className={styles.sidebarContent}>
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              className={`${styles.projectItem}${selectedProjectId === project.id ? ` ${styles.projectItemActive}` : ''}`}
              onClick={() => onSelectProject(project)}
            >
              <IconBox size={16} className={styles.projectIcon} />
              <div className={styles.projectInfo}>
                <div className={styles.projectName}>{project.name}</div>
                <div className={styles.projectMeta}>
                  {project.currentReleaseId ? 'Live' : 'Draft'}
                </div>
              </div>
            </button>
          ))}

          <button
            type="button"
            className={styles.projectItem}
            onClick={onCreateProject}
            style={{ marginTop: 8, color: 'var(--color-text-secondary)' }}
          >
            <IconPlus size={16} />
            <span>New Project</span>
          </button>
        </div>

        <div className={styles.sidebarFooter}>
          <Dropdown
            upward
            trigger={
              <div className={styles.userArea}>
                <Avatar name={user.name} size="md" />
                <div className={styles.userInfo}>
                  <div className={styles.userName}>{user.name}</div>
                  <div className={styles.userEmail}>{user.email}</div>
                </div>
                <IconChevronUp size={14} style={{ color: 'var(--color-text-tertiary)' }} />
              </div>
            }
            items={[
              { label: 'Profile', icon: <IconUser size={18} />, onClick: () => {} },
              { label: 'Settings', icon: <IconSettings size={18} />, onClick: () => {} },
              { divider: true },
              { label: 'Sign out', icon: <IconLogout size={18} />, danger: true, onClick: onLogout },
            ]}
          />
        </div>
      </aside>

      {/* ─── Content ─── */}
      <div className={styles.content}>
        <div className={styles.contentHeader}>
          <div>{headerExtra}</div>
          <div />
        </div>
        <div className={styles.contentBody}>
          {children}
        </div>
      </div>
    </div>
  );
}
