import { useNavigate } from 'react-router';
import { useAuthStore, useProjectsStore } from '../stores';
import { Breadcrumb } from '../shared/ui/Breadcrumb';
import { ProjectList } from '../features/projects/ProjectList';

export function ProjectListPage() {
  const { refreshToken } = useAuthStore();
  const { projects, loading, fetchProjects } = useProjectsStore();
  const navigate = useNavigate();

  const apiBaseUrl =
    (typeof window !== 'undefined' && (window as any).__ZIPSHIP_API_BASE_URL) ?? 'http://localhost:3001';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Breadcrumb items={[{ label: 'Projects' }]} />
      <ProjectList
        projects={projects}
        loading={loading}
        onSelect={(p) => navigate(`/app/projects/${p.id}`)}
        onCreate={() => {}}
        onRefresh={() => refreshToken && fetchProjects(apiBaseUrl, refreshToken)}
      />
    </div>
  );
}
