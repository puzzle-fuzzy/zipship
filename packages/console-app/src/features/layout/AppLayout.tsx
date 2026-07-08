import { useEffect, useState } from 'react';
import { Outlet } from 'react-router';
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
import { ProfileEditDialog } from '../settings/ProfileEditDialog';
import { SettingsDialog } from '../settings/SettingsDialog';
import { CreateProjectDialog } from '../projects/CreateProjectDialog';
import { AppHeader } from './AppHeader';
import { AppSidebar } from './AppSidebar';

export function AppLayout() {
  const { t } = useTranslation();
  const { user, refreshToken, logout } = useAuthStore();
  const { fetchProjects, createProject } = useProjectsStore();
  const [showCreate, setShowCreate] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  useEffect(() => {
    if (refreshToken) {
      fetchProjects();
    }
  }, [refreshToken, fetchProjects]);

  const handleLogout = () => {
    setShowLogoutConfirm(false);
    logout();
    toast.info(t('app.signOut'));
  };

  return (
    <>
      <SidebarProvider className="mx-auto h-svh w-full items-start">
        <AppSidebar />
        <main className="flex h-svh flex-1 flex-col overflow-hidden">
          <ScrollArea className="h-svh w-full">
            <AppHeader
              user={user!}
              onNewProject={() => setShowCreate(true)}
              onLogout={() => setShowLogoutConfirm(true)}
              onOpenSettings={() => setShowSettings(true)}
              onOpenProfile={() => setShowProfile(true)}
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
          await createProject({
            name,
            slug,
            description,
          });
          await fetchProjects();
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

      <ProfileEditDialog
        open={showProfile}
        onClose={() => setShowProfile(false)}
      />
    </>
  );
}
