import { useEffect, useState } from "react";
import { Outlet, useNavigate, useParams } from "react-router";
import { useAuthStore, useProjectsStore } from "../../stores";
import { useToastStore } from "../../stores/toastStore";
import { useTranslation } from "../../i18n";
import { Button } from "../../shared/ui/Button";
import { Dialog } from "../../shared/ui/Dialog";
import { SettingsDialog } from "../settings/SettingsDialog";
import { CreateProjectDialog } from "../projects/CreateProjectDialog";
import { Layout } from "./Layout";

export function AppLayout() {
  const { t } = useTranslation();
  const { user, refreshToken, logout } = useAuthStore();
  const { projects, fetchProjects, createProject } = useProjectsStore();
  const { addToast } = useToastStore();
  const navigate = useNavigate();
  const params = useParams();
  const [showCreate, setShowCreate] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const apiBaseUrl =
    (typeof window !== "undefined" && (window as any).__ZIPSHIP_API_BASE_URL) ??
    "http://localhost:3001";

  useEffect(() => {
    if (refreshToken) {
      fetchProjects(apiBaseUrl, refreshToken);
    }
  }, [refreshToken, fetchProjects, apiBaseUrl]);

  const selectedProjectId = params.projectId ?? null;

  const handleSelectProject = (
    project: { id: string; name: string } | null,
  ) => {
    if (project) {
      navigate(`/app/projects/${project.id}`);
    } else {
      navigate("/app");
    }
  };

  const handleLogout = () => {
    setShowLogoutConfirm(false);
    logout();
    addToast({ type: "info", title: t("app.signOut") });
  };

  const handleHelp = () => {
    addToast({
      type: "info",
      title: "ZipShip Docs",
      message: "https://github.com/zipship",
    });
  };

  return (
    <>
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

      <Layout
        user={user!}
        projects={projects}
        selectedProjectId={selectedProjectId}
        onSelectProject={handleSelectProject}
        onCreateProject={() => setShowCreate(true)}
        onLogout={() => setShowLogoutConfirm(true)}
        onOpenSettings={() => setShowSettings(true)}
        onHelp={handleHelp}
      >
        <Outlet context={{ setShowCreate, setShowSettings }} />
      </Layout>

      <Dialog
        open={showLogoutConfirm}
        title={t("app.signOut")}
        onClose={() => setShowLogoutConfirm(false)}
        width={380}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <p
            style={{
              fontSize: "var(--font-size-sm)",
              color: "var(--color-text-secondary)",
              lineHeight: 1.5,
            }}
          >
            {t("help.signOutDesc")}
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button
              variant="secondary"
              onClick={() => setShowLogoutConfirm(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={handleLogout}>{t("app.signOut")}</Button>
          </div>
        </div>
      </Dialog>

      <SettingsDialog
        open={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </>
  );
}
