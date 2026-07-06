import { IconMenu2, IconPlus, IconRocket, IconX } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { useTranslation } from '../../i18n';
import styles from './Layout.module.css';

interface Project {
  id: string;
  name: string;
  slug: string;
  currentReleaseId: string | null;
}

interface LayoutProps {
  projects: Project[];
  selectedProjectId: string | null;
  onSelectProject: (project: Project | null) => void;
  onCreateProject: () => void;
  children: ReactNode;
  headerExtra?: ReactNode;
  sidebarFooter?: ReactNode;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onCloseSidebar: () => void;
}

export function Layout({
  projects,
  selectedProjectId,
  onSelectProject,
  onCreateProject,
  children,
  headerExtra,
  sidebarFooter,
  sidebarOpen,
  onToggleSidebar,
  onCloseSidebar,
}: LayoutProps) {
  const { t } = useTranslation();

  // Close sidebar on navigation (project selection)
  const handleSelectProject = (project: Project | null) => {
    onSelectProject(project);
    onCloseSidebar();
  };

  // Close sidebar on Escape key
  useEffect(() => {
    if (!sidebarOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseSidebar();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [sidebarOpen, onCloseSidebar]);

  return (
    <div className={styles.layout}>
      {/* Mobile overlay */}
      {sidebarOpen && <div className={styles.overlay} onClick={onCloseSidebar} />}

      <aside
        className={`${styles.sidebar}${sidebarOpen ? ` ${styles.sidebarOpen}` : ''}`}
        aria-label={t('app.projects')}
      >
        <div className={styles.sidebarHeader}>
          <IconRocket size={22} className={styles.sidebarLogo} />
          <span className={styles.sidebarTitle}>{t('app.name')}</span>
          <button
            type="button"
            className={styles.sidebarClose}
            onClick={onCloseSidebar}
            aria-label="Close sidebar"
          >
            <IconX size={18} />
          </button>
        </div>

        <nav className={styles.sidebarContent} aria-label={t('projects.title')}>
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              className={`${styles.projectItem}${selectedProjectId === project.id ? ` ${styles.projectItemActive}` : ''}`}
              onClick={() => handleSelectProject(project)}
              {...(selectedProjectId === project.id ? { 'aria-current': 'page' as const } : {})}
            >
              <span className={`${styles.dot} ${project.currentReleaseId ? styles.dotLive : styles.dotDraft}`} />
              <span className={styles.projectName}>{project.name}</span>
            </button>
          ))}

          <button
            type="button"
            className={styles.projectItem}
            onClick={() => {
              onCreateProject();
              onCloseSidebar();
            }}
          >
            <IconPlus size={16} />
            <span>{t('app.newProject')}</span>
          </button>
        </nav>

        {sidebarFooter && <div className={styles.sidebarFooter}>{sidebarFooter}</div>}
      </aside>

      <div className={styles.content}>
        <div className={styles.contentHeader}>
          <button
            type="button"
            className={styles.menuButton}
            onClick={onToggleSidebar}
            aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          >
            <IconMenu2 size={20} />
          </button>
          {headerExtra && <div className={styles.headerExtra}>{headerExtra}</div>}
        </div>
        <main className={styles.contentBody}>{children}</main>
      </div>
    </div>
  );
}
