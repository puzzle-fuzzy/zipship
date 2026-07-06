import { IconBox, IconPlus, IconRocket } from '@tabler/icons-react';
import type { ReactNode } from 'react';
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
}

export function Layout({
  projects,
  selectedProjectId,
  onSelectProject,
  onCreateProject,
  children,
  headerExtra,
  sidebarFooter,
}: LayoutProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <IconRocket size={22} className={styles.sidebarLogo} />
          <span className={styles.sidebarTitle}>{t('app.name')}</span>
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
                  {project.currentReleaseId ? t('projects.live') : t('projects.draft')}
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
            <span>{t('app.newProject')}</span>
          </button>
        </div>

        {sidebarFooter && <div className={styles.sidebarFooter}>{sidebarFooter}</div>}
      </aside>

      <div className={styles.content}>
        {headerExtra && (
          <div className={styles.contentHeader}>
            <div>{headerExtra}</div>
            <div />
          </div>
        )}
        <div className={styles.contentBody}>{children}</div>
      </div>
    </div>
  );
}
