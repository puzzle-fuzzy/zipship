import { IconBox, IconFolderOpen, IconRefresh } from '@tabler/icons-react';
import { useTranslation } from '../../i18n';
import { Badge } from '../../shared/ui/Badge';
import { Button } from '../../shared/ui/Button';
import { Card } from '../../shared/ui/Card';
import styles from './ProjectList.module.css';

interface Project {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  currentReleaseId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ProjectListProps {
  projects: Project[];
  loading: boolean;
  onSelect: (project: Project) => void;
  onRefresh: () => void;
}

export function ProjectList({ projects, loading, onSelect, onRefresh }: ProjectListProps) {
  const { t } = useTranslation();

  if (loading) {
    return <Card title={t('projects.title')}>{t('common.loading')}</Card>;
  }

  if (projects.length === 0) {
    return (
      <Card>
        <div className={styles.emptyState}>
          <IconFolderOpen size={40} className={styles.emptyIcon} />
          <h3 className={styles.emptyTitle}>{t('projects.empty')}</h3>
          <p className={styles.emptyDesc}>{t('projects.emptyDesc')}</p>
        </div>
      </Card>
    );
  }

  return (
    <Card
      title={t('projects.title')}
      action={
        <Button variant="ghost" size="sm" onClick={onRefresh} aria-label="Refresh projects list">
          <IconRefresh size={14} />
        </Button>
      }
    >
      <div className={styles.listItems}>
        {projects.map((project) => (
          <button
            key={project.id}
            type="button"
            className={styles.projectRow}
            onClick={() => onSelect(project)}
          >
            <IconBox size={18} className={styles.projectRowIcon} />
            <div className={styles.projectRowInfo}>
              <div className={styles.projectRowTop}>
                <span className={styles.projectRowName}>{project.name}</span>
                <Badge variant={project.currentReleaseId ? 'success' : 'outline'}>
                  {project.currentReleaseId ? t('projects.live') : t('projects.draft')}
                </Badge>
              </div>
              <div className={styles.projectRowMeta}>
                /{project.slug}
                {project.description ? ` · ${project.description}` : ''}
              </div>
            </div>
          </button>
        ))}
      </div>
    </Card>
  );
}
