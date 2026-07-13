import { useEffect, useState } from 'react';
import { Outlet } from 'react-router';
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
import { useTranslation } from '../../i18n';
import { useAuthStore, useProjectsStore } from '../../stores';
import { CreateProjectDialog } from '../projects/CreateProjectDialog';
import { ProfileEditDialog } from '../settings/ProfileEditDialog';
import { SettingsDialog } from '../settings/SettingsDialog';
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
      <div className="min-h-dvh bg-background">
        <AppHeader
          user={user!}
          onNewProject={() => setShowCreate(true)}
          onLogout={() => setShowLogoutConfirm(true)}
          onOpenSettings={() => setShowSettings(true)}
          onOpenProfile={() => setShowProfile(true)}
        />

        <div className="mx-auto flex w-full max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:px-8">
          <AppSidebar />
          <main className="min-w-0 flex-1">
            <ScrollArea className="h-[calc(100dvh-6.5rem)]">
              <div className="pb-10">
                <Outlet context={{ setShowCreate, setShowSettings }} />
              </div>
            </ScrollArea>
          </main>
        </div>
      </div>

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
            <DialogDescription>{t('help.signOutDesc')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLogoutConfirm(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleLogout}>{t('app.signOut')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />

      <ProfileEditDialog open={showProfile} onClose={() => setShowProfile(false)} />
    </>
  );
}
