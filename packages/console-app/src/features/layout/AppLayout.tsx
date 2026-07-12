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
      <div className="zip-stage min-h-dvh">
        <AppSidebar />
        <main className="relative z-10 flex min-h-dvh flex-1 flex-col overflow-hidden">
          <ScrollArea className="h-dvh w-full">
            <AppHeader
              user={user!}
              onNewProject={() => setShowCreate(true)}
              onLogout={() => setShowLogoutConfirm(true)}
              onOpenSettings={() => setShowSettings(true)}
              onOpenProfile={() => setShowProfile(true)}
            />
            <div className="flex w-full flex-1 flex-col gap-4 overflow-y-auto px-4 pb-8 pt-0 sm:px-6">
              <Outlet context={{ setShowCreate, setShowSettings }} />
            </div>
          </ScrollArea>
        </main>
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
