import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { toast } from '../../lib/toast';
import { Button } from '../../components/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/primitives/dialog';
import { useTranslation } from '../../i18n';
import { useAuthStore, useOrganizationsStore, useProjectsStore } from '../../stores';
import { CreateProjectDialog } from '../projects/CreateProjectDialog';
import { ProfileEditDialog } from '../settings/ProfileEditDialog';
import { SettingsDialog } from '../settings/SettingsDialog';
import { AppHeader } from './AppHeader';

export function AppLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { fetchProjects, createProject } = useProjectsStore();
  const {
    organizations,
    selectedOrganizationId,
    loading: organizationsLoading,
    initialized: organizationsInitialized,
    initializeOrganizations,
    selectOrganization,
    resetOrganizations,
  } = useOrganizationsStore();
  const [showCreate, setShowCreate] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  useEffect(() => {
    void initializeOrganizations();
  }, [initializeOrganizations]);

  useEffect(() => {
    if (!organizationsInitialized) return;
    void fetchProjects(selectedOrganizationId);
  }, [fetchProjects, organizationsInitialized, selectedOrganizationId]);

  const handleLogout = async () => {
    try {
      await logout();
      resetOrganizations();
      await fetchProjects(null);
      setShowLogoutConfirm(false);
      toast.info(t('app.signOut'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('auth.signOutFailed'));
    }
  };

  return (
    <>
      <div className="min-h-dvh bg-background">
        <AppHeader
          user={user!}
          organizations={organizations}
          selectedOrganizationId={selectedOrganizationId}
          organizationsLoading={organizationsLoading}
          onOrganizationChange={(organizationId) => {
            if (!selectOrganization(organizationId)) return;
            navigate('/app/projects');
          }}
          onLogout={() => setShowLogoutConfirm(true)}
          onOpenSettings={() => setShowSettings(true)}
          onOpenProfile={() => setShowProfile(true)}
        />

        <main className="mx-auto min-h-[calc(100dvh-4rem)] w-full max-w-[67.5rem] px-4 sm:px-6 lg:px-8">
          <Outlet context={{ setShowCreate }} />
        </main>
      </div>

      <CreateProjectDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={async ({ name, slug, description }) => {
          if (!selectedOrganizationId) {
            throw new Error(t('organizations.required'));
          }
          await createProject(selectedOrganizationId, {
            name,
            slug,
            description,
          });
          await fetchProjects(selectedOrganizationId);
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
            <Button onClick={() => void handleLogout()}>{t('app.signOut')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />

      <ProfileEditDialog open={showProfile} onClose={() => setShowProfile(false)} />
    </>
  );
}
