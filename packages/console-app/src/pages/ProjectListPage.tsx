import { useNavigate, useOutletContext } from 'react-router';
import { useAuthStore, useProjectsStore } from '../stores';
import { useTranslation } from '../i18n';
import { Breadcrumb } from '../shared/ui/Breadcrumb';
import { ProjectList } from '../features/projects/ProjectList';

export function ProjectListPage() {
  const { t } = useTranslation();
  const { refreshToken } = useAuthStore();
  const { projects, loading, fetchProjects } = useProjectsStore();
  const navigate = useNavigate();
  const { setShowCreate } = useOutletContext<{ setShowCreate: (v: boolean) => void }>();

  const apiBaseUrl =
    (typeof window !== 'undefined' && (window as any).__ZIPSHIP_API_BASE_URL) ?? 'http://localhost:3001';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Breadcrumb items={[{ label: t('projects.title') }]} />
      <ProjectList
        projects={projects}
        loading={loading}
        onSelect={(p) => navigate(`/app/projects/${p.id}`)}
        onCreate={() => setShowCreate(true)}
        onRefresh={() => refreshToken && fetchProjects(apiBaseUrl, refreshToken)}
      />
    </div>
  );
}
