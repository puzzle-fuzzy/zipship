import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router';
import { useAuthStore, useProjectsStore } from '../../stores';
import { useTranslation } from '../../i18n';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { ScrollArea } from '../../components/ui/scroll-area';
import { SidebarProvider } from '../../components/ui/sidebar';
import { SettingsDialog } from '../settings/SettingsDialog';
import { CreateProjectDialog } from '../projects/CreateProjectDialog';
import { AppHeader } from './AppHeader';
import { AppSidebar } from './AppSidebar';

export function AppLayout() {
  const { t } = useTranslation();
  const { user, refreshToken, logout } = useAuthStore();
  const { projects, fetchProjects, createProject } = useProjectsStore();
  const navigate = useNavigate();
  const params = useParams();
  const [showCreate, setShowCreate] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const apiBaseUrl =
    (typeof window !== 'undefined' && (window as any).__ZIPSHIP_API_BASE_URL) ??
    'http://localhost:3001';

  useEffect(() => {
    if (refreshToken) {
      fetchProjects(apiBaseUrl, refreshToken);
    }
  }, [refreshToken, fetchProjects, apiBaseUrl]);

  const selectedProjectId = params.projectId ?? null;

  const handleSelectProject = (
    project: { id: string; name: string },
  ) => {
    navigate(`/app/projects/${project.id}`);
  };

  const handleShowProjects = () => {
    navigate('/app');
  };

  const handleLogout = () => {
    setShowLogoutConfirm(false);
    logout();
    toast.info(t('app.signOut'));
  };

  return (
    <>
      <SidebarProvider className="mx-auto h-svh w-full max-w-6xl items-start">
        <AppSidebar
          projects={projects}
          selectedProjectId={selectedProjectId}
          onSelectProject={handleSelectProject}
          onShowProjects={handleShowProjects}
          onCreateProject={() => setShowCreate(true)}
        />
        <main className="flex h-svh flex-1 flex-col overflow-hidden">
          <ScrollArea className="h-svh w-full">
            <AppHeader
              user={user!}
              onLogout={() => setShowLogoutConfirm(true)}
              onOpenSettings={() => setShowSettings(true)}
            />
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-6 pt-0">
              <Outlet context={{ setShowCreate, setShowSettings }} />
            </div>
          </ScrollArea>
        </main>
      </SidebarProvider>

      <CreateProjectDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={async ({ name, slug, description }) => {
          await createProject(apiBaseUrl, refreshToken!, {
            name,
            slug,
            description,
          });
          await fetchProjects(apiBaseUrl, refreshToken!);
          setShowCreate(false);
        }}
      />

      <Dialog open={showLogoutConfirm} onOpenChange={setShowLogoutConfirm}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('app.signOut')}</DialogTitle>
            <DialogDescription>
              {t('help.signOutDesc')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowLogoutConfirm(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button onClick={handleLogout}>{t('app.signOut')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SettingsDialog
        open={showSettings}
        onClose={() => setShowSettings(false)}
      />

    </>
  );
}
