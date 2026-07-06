import { IconBox, IconFolderOpen, IconPlus, IconRefresh } from '@tabler/icons-react';
import { useNavigate, useOutletContext } from 'react-router';
import { useAuthStore, useProjectsStore } from '../stores';
import { useTranslation } from '../i18n';
import { Badge } from '../shared/ui/Badge';
import { Button } from '../shared/ui/Button';
import styles from '../features/layout/Layout.module.css';

export function ProjectListPage() {
  const { t } = useTranslation();
  const { user, refreshToken } = useAuthStore();
  const { projects, loading, fetchProjects } = useProjectsStore();
  const navigate = useNavigate();
  const { setShowCreate } = useOutletContext<{ setShowCreate: (v: boolean) => void }>();

  const apiBaseUrl =
    (typeof window !== 'undefined' && (window as any).__ZIPSHIP_API_BASE_URL) ?? 'http://localhost:3001';

  const liveProjectsCount = projects.filter((p) => p.currentReleaseId).length;

  return (
    <div>
      <div className={styles.projectsHeader}>
        <div>
          <h1 className={styles.projectsTitle}>{t('projects.title')}</h1>
          <p className={styles.projectsSubtitle}>
            {projects.length} {t('app.projects')} / {liveProjectsCount} {t('projects.live')}
          </p>
        </div>
        <div className={styles.projectsActions}>
          <Button variant="secondary" size="sm" onClick={() => refreshToken && fetchProjects(apiBaseUrl, refreshToken)}>
            <IconRefresh size={14} />
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <IconPlus size={14} />
            {t('app.newProject')}
          </Button>
        </div>
      </div>

      <div className={styles.grid}>
        {/* ─── Project Cards ─── */}
        <div className={styles.cardGrid}>
          {loading ? (
            <div className={styles.emptyState}>
              <p style={{ color: 'var(--color-text-tertiary)' }}>{t('common.loading')}</p>
            </div>
          ) : projects.length === 0 ? (
            <div className={styles.emptyState}>
              <IconFolderOpen size={40} className={styles.emptyIcon} />
              <h3 className={styles.emptyTitle}>{t('projects.empty')}</h3>
              <p className={styles.emptyDesc}>{t('projects.emptyDesc')}</p>
              <Button onClick={() => setShowCreate(true)}>
                <IconPlus size={16} />
                {t('app.newProject')}
              </Button>
            </div>
          ) : (
            projects.map((project) => (
              <button
                key={project.id}
                type="button"
                className={styles.projectCard}
                onClick={() => navigate(`/app/projects/${project.id}`)}
              >
                <div className={styles.cardTop}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className={styles.cardName}>{project.name}</div>
                    <div className={styles.cardSlug}>/{project.slug}</div>
                  </div>
                  <Badge variant={project.currentReleaseId ? 'success' : 'outline'}>
                    {project.currentReleaseId ? t('projects.live') : t('projects.draft')}
                  </Badge>
                </div>
                <div className={styles.cardFooter}>
                  <span className={styles.cardStat}>
                    <IconBox size={12} />
                    {project.currentReleaseId ? t('projects.live') : t('projects.draft')}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>

        {/* ─── Workspace Sidebar ─── */}
        <div className={styles.workspaceCard}>
          <div className={styles.workspaceTitle}>Workspace</div>
          <div className={styles.workspaceEmail}>{user?.email}</div>
          <div className={styles.workspaceRow}>
            <span className={styles.workspaceLabel}>{t('app.projects')}</span>
            <span className={styles.workspaceValue}>{projects.length}</span>
          </div>
          <div className={styles.workspaceRow}>
            <span className={styles.workspaceLabel}>{t('projects.live')}</span>
            <span className={styles.workspaceValue}>{liveProjectsCount}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
