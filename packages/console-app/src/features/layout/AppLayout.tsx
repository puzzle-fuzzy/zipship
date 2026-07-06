import { IconChevronUp, IconLogout, IconSettings, IconUser } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router';
import { useAuthStore, useProjectsStore } from '../../stores';
import { Avatar } from '../../shared/ui/Avatar';
import { Dropdown } from '../../shared/ui/Dropdown';
import { CreateProjectDialog } from '../projects/CreateProjectDialog';
import { Layout } from './Layout';
import layoutStyles from './Layout.module.css';

export function AppLayout() {
  const { user, refreshToken, logout } = useAuthStore();
  const { projects, fetchProjects, createProject } = useProjectsStore();
  const navigate = useNavigate();
  const params = useParams();
  const [showCreate, setShowCreate] = useState(false);

  const apiBaseUrl =
    (typeof window !== 'undefined' && (window as any).__ZIPSHIP_API_BASE_URL) ?? 'http://localhost:3001';

  useEffect(() => {
    if (refreshToken) {
      fetchProjects(apiBaseUrl, refreshToken);
    }
  }, [refreshToken, fetchProjects, apiBaseUrl]);

  const selectedProjectId = params.projectId ?? null;

  return (
    <>
      <Layout
        user={user!}
        projects={projects}
        selectedProjectId={selectedProjectId}
        onSelectProject={(project) => {
          navigate(project ? `/app/projects/${project.id}` : '/app');
        }}
        onCreateProject={() => setShowCreate(true)}
        onLogout={logout}
        sidebarFooter={
          <Dropdown
            upward
            trigger={
              <div className={layoutStyles.userArea}>
                <Avatar name={user!.name} size="md" />
                <div className={layoutStyles.userInfo}>
                  <div className={layoutStyles.userName}>{user!.name}</div>
                  <div className={layoutStyles.userEmail}>{user!.email}</div>
                </div>
                <IconChevronUp size={14} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
              </div>
            }
            items={[
              { label: 'Profile', icon: <IconUser size={18} />, onClick: () => {} },
              { label: 'Settings', icon: <IconSettings size={18} />, onClick: () => {} },
              { divider: true },
              { label: 'Sign out', icon: <IconLogout size={18} />, danger: true, onClick: logout },
            ]}
          />
        }
      >
        <Outlet />
      </Layout>

      <CreateProjectDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={async ({ name, slug, description }) => {
          try {
            await createProject(apiBaseUrl, refreshToken!, { name, slug, description });
            await fetchProjects(apiBaseUrl, refreshToken!);
            setShowCreate(false);
          } catch (err) {
            console.error(err);
          }
        }}
      />
    </>
  );
}
