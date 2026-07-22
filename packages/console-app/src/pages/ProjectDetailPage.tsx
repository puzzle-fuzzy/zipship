import { ArrowLeft, Code2, FolderX, History, RefreshCw, Rocket, Settings, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import {
  useAuditStore,
  useAuthStore,
  useMembersStore,
  useOrganizationsStore,
  useProjectsStore,
} from "../stores";
import { getAccessPlaneBaseUrl } from "../api/client";
import { useTranslation } from "../i18n";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/primitives/tabs";
import { InviteMemberDialog } from "../features/members/InviteMemberDialog";
import { UploadVersionDialog } from "../features/versions/UploadVersionDialog";
import { ProjectActivityTab } from "../features/project-detail/ProjectActivityTab";
import { ProjectDetailHeader } from "../features/project-detail/ProjectDetailHeader";
import { ProjectDeploymentsTab } from "../features/project-detail/ProjectDeploymentsTab";
import { ProjectMembersTab } from "../features/project-detail/ProjectMembersTab";
import { ProjectPreviewPanel } from "../features/project-detail/ProjectPreviewPanel";
import { ProjectProductionPanel } from "../features/project-detail/ProjectProductionPanel";
import { ProjectSettingsTab } from "../features/project-detail/ProjectSettingsTab";
import { ProjectVersionsTab } from "../features/project-detail/ProjectVersionsTab";
import { buildSitePreviewUrl } from "../features/project-detail/projectPreviewUrls";
import { getProjectRolePermissions } from "../features/project-detail/rolePermissions";
import { findUploadedReleaseHighlight } from "../features/project-detail/uploadResultHighlight";
import { useProjectReleasePolling } from "../features/project-detail/useProjectReleasePolling";
import type { Release } from "../stores/projectsStore";
import { Button } from "../components/primitives/button";
import { useRuntime } from "../runtime";
import { toast } from "../lib/toast";

type ProjectDetailTab = "versions" | "members" | "deployments" | "settings" | "activity";

/**
 * Project detail orchestrator: resolves the project from the store, fetches its
 * releases / members / audit trail, and delegates each tab's rendering to a
 * dedicated component. Business actions are passed down as callbacks so the
 * tabs stay presentational and independently testable.
 */
export function ProjectDetailPage() {
  const { t } = useTranslation();
  const runtime = useRuntime();
  const navigate = useNavigate();
  const { projectId } = useParams();
  const { user } = useAuthStore();
  const {
    projects,
    projectsOrganizationId,
    loading: projectsLoading,
    releases,
    releaseErrors,
    deployments,
    deploymentErrors,
    fetchReleases,
    fetchDeployments,
    resolveProject,
    publishRelease,
    rollbackRelease,
    updateProject,
  } = useProjectsStore();
  const {
    selectedOrganizationId,
    loading: organizationsLoading,
    initialized: organizationsInitialized,
    error: organizationsError,
    selectOrganization,
  } = useOrganizationsStore();
  const {
    members,
    membersOrganizationId,
    invitations,
    fetchMembers,
    fetchInvitations,
    clearInvitations,
    loading: membersLoading,
    invitationsLoading,
    invitationsError,
    updateMemberRole,
    removeMember,
    revokeInvitation,
  } = useMembersStore();
  const { logs: auditLogs, loading: auditLoading, error: auditError, fetchAudit } =
    useAuditStore();
  const [showUpload, setShowUpload] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ProjectDetailTab>("versions");
  const [pendingUploadAnchorId, setPendingUploadAnchorId] = useState<string | null | undefined>(undefined);
  const [highlightedReleaseId, setHighlightedReleaseId] = useState<string | null>(null);
  const [resolvedProject, setResolvedProject] = useState<
    Awaited<ReturnType<typeof resolveProject>>
  >(null);
  const [projectResolution, setProjectResolution] = useState<
    "loading" | "ready" | "not-found" | "error"
  >("loading");
  const [projectResolutionAttempt, setProjectResolutionAttempt] = useState(0);

  const listedProject = projects.find((candidate) => candidate.id === projectId) ?? null;
  const project =
    listedProject ?? (resolvedProject?.id === projectId ? resolvedProject : null);
  const currentMember =
    membersOrganizationId === project?.organizationId
      ? members.find((member) => member.userId === user?.id)
      : undefined;
  const permissions = getProjectRolePermissions(currentMember);
  const projectReleases = useMemo(
    () => (projectId ? releases[projectId] ?? [] : []),
    [projectId, releases],
  );
  const releaseError = projectId ? releaseErrors[projectId] ?? null : null;
  const projectDeployments = projectId ? deployments[projectId] ?? [] : [];
  const deploymentError = projectId ? deploymentErrors[projectId] ?? null : null;
  const { releasePollingEnabled, startReleasePolling } = useProjectReleasePolling({
    projectId,
    releases: projectReleases,
    fetchReleases,
  });

  useEffect(() => {
    let cancelled = false;

    if (!projectId) {
      setResolvedProject(null);
      setProjectResolution("not-found");
      return;
    }
    if (listedProject || resolvedProject?.id === projectId) {
      setProjectResolution("ready");
      return;
    }
    if (!organizationsInitialized || organizationsLoading) {
      setProjectResolution("loading");
      return;
    }
    if (organizationsError) {
      setProjectResolution("error");
      return;
    }
    if (!selectedOrganizationId) {
      setProjectResolution("not-found");
      return;
    }
    if (
      projectsLoading ||
      projectsOrganizationId !== selectedOrganizationId
    ) {
      setProjectResolution("loading");
      return;
    }

    setProjectResolution("loading");
    void resolveProject(projectId)
      .then((resolved) => {
        if (cancelled) return;
        if (!resolved) {
          setResolvedProject(null);
          setProjectResolution("not-found");
          return;
        }
        if (
          resolved.organizationId !== selectedOrganizationId &&
          !selectOrganization(resolved.organizationId)
        ) {
          setResolvedProject(null);
          setProjectResolution("error");
          return;
        }
        setResolvedProject(resolved);
        setProjectResolution("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setResolvedProject(null);
        setProjectResolution("error");
      });

    return () => {
      cancelled = true;
    };
  }, [
    projectId,
    listedProject,
    resolvedProject,
    organizationsInitialized,
    organizationsLoading,
    organizationsError,
    selectedOrganizationId,
    projectsLoading,
    projectsOrganizationId,
    resolveProject,
    selectOrganization,
    projectResolutionAttempt,
  ]);

  useEffect(() => {
    if (projectId) {
      fetchReleases(projectId).finally(() => setLoading(false));
      fetchDeployments(projectId);
    }
  }, [projectId, fetchReleases, fetchDeployments]);

  useEffect(() => {
    const organizationId = project?.organizationId;
    if (organizationId) {
      fetchMembers(organizationId);
      fetchAudit(organizationId);
    }
  }, [project?.organizationId, fetchMembers, fetchAudit]);

  useEffect(() => {
    const organizationId = project?.organizationId;
    if (
      organizationId &&
      membersOrganizationId === organizationId &&
      permissions.canManageMembers
    ) {
      void fetchInvitations(organizationId);
    } else {
      clearInvitations();
    }
  }, [
    project?.organizationId,
    membersOrganizationId,
    permissions.canManageMembers,
    fetchInvitations,
    clearInvitations,
  ]);

  useEffect(() => {
    if (pendingUploadAnchorId === undefined) return;

    const nextHighlightId = findUploadedReleaseHighlight(projectReleases, pendingUploadAnchorId);
    if (!nextHighlightId) return;

    setActiveTab("versions");
    setHighlightedReleaseId(nextHighlightId);
    setPendingUploadAnchorId(undefined);
  }, [pendingUploadAnchorId, projectReleases]);

  if (!project) {
    if (projectResolution === "not-found") {
      return (
        <ProjectResolutionState
          title={t("projects.detailNotFoundTitle")}
          description={t("projects.detailNotFoundDesc")}
          onBack={() => navigate("/app/projects")}
        />
      );
    }
    if (projectResolution === "error") {
      return (
        <ProjectResolutionState
          title={t("projects.detailLoadFailedTitle")}
          description={t("projects.detailLoadFailedDesc")}
          onBack={() => navigate("/app/projects")}
          onRetry={() => {
            setProjectResolution("loading");
            setProjectResolutionAttempt((attempt) => attempt + 1);
          }}
        />
      );
    }
    return <ProjectDetailLoading label={t("common.loading")} />;
  }

  const activeRelease = projectReleases.find((r) => r.status === "active");
  const previewRelease =
    activeRelease ??
    projectReleases.find((release) => release.status === "ready") ??
    projectReleases.find((release) => release.releaseHash) ??
    null;
  const previewUrl = previewRelease
    ? buildSitePreviewUrl(getAccessPlaneBaseUrl(), project.slug, previewRelease.id)
    : null;

  const handlePreview = (release: Release) => {
    void runtime
      .openExternal(
        buildSitePreviewUrl(getAccessPlaneBaseUrl(), project.slug, release.id),
      )
      .catch(() => toast.error(t("preview.openFailed")));
  };

  const handleRetryReleases = () => {
    if (!projectId) return;
    setLoading(true);
    fetchReleases(projectId).finally(() => setLoading(false));
  };

  const handleRetryDeployments = () => {
    if (!projectId) return;
    fetchDeployments(projectId);
  };

  const handleUploadCompleted = () => {
    setPendingUploadAnchorId(projectReleases[0]?.id ?? null);
    startReleasePolling();
    void fetchReleases(project.id);
  };

  return (
    <section className="flex flex-col gap-5 py-6">
      <ProjectDetailHeader
        project={project}
        activeRelease={activeRelease}
        canUpload={permissions.canUploadRelease}
        onOpenActiveRelease={handlePreview}
        onUploadClick={() => setShowUpload(true)}
      />

      <ProjectProductionPanel
        projectSlug={project.slug}
        activeRelease={activeRelease}
        canUpload={permissions.canUploadRelease}
        onUploadClick={() => setShowUpload(true)}
      />

      <ProjectPreviewPanel
        release={previewRelease}
        previewUrl={previewUrl}
        canUpload={permissions.canUploadRelease}
        onOpenPreview={handlePreview}
        onUploadClick={() => setShowUpload(true)}
      />

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ProjectDetailTab)}>
        <TabsList variant="line">
          <TabsTrigger value="versions">
            <Code2 className="size-4" />
            {t("versions.title")}
          </TabsTrigger>
          <TabsTrigger value="members">
            <Users className="size-4" />
            {t("members.title")}
          </TabsTrigger>
          <TabsTrigger value="deployments">
            <Rocket className="size-4" />
            {t("deployments.title")}
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings className="size-4" />
            {t("settings.title")}
          </TabsTrigger>
          <TabsTrigger value="activity">
            <History className="size-4" />
            {t("activity.title")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="versions" className="pt-3">
          <ProjectVersionsTab
            releases={projectReleases}
            loading={loading}
            error={releaseError}
            autoRefreshing={releasePollingEnabled}
            highlightedReleaseId={highlightedReleaseId}
            canUpload={permissions.canUploadRelease}
            canDeploy={permissions.canDeployRelease}
            canDelete={permissions.canManageProject}
            onUploadClick={() => setShowUpload(true)}
            onRetry={handleRetryReleases}
            onPreview={handlePreview}
            onPublish={(release, message) => publishRelease(project.id, release.id, message)}
            onRollback={(release, message) => rollbackRelease(project.id, release.id, message)}
          />
        </TabsContent>

        <TabsContent value="members" className="pt-3">
          <ProjectMembersTab
            members={members}
            invitations={invitations}
            loading={membersLoading}
            invitationsLoading={invitationsLoading}
            invitationsError={invitationsError}
            canManage={permissions.canManageMembers}
            currentUserId={user?.id ?? null}
            currentUserRole={currentMember?.role ?? null}
            onInviteClick={() => setShowInvite(true)}
            onRetryInvitations={() => fetchInvitations(project.organizationId)}
            onChangeRole={(member, role) =>
              updateMemberRole(project.organizationId, member.userId, role)
            }
            onRemove={(member) => removeMember(project.organizationId, member.userId)}
            onRevokeInvitation={(invitation) =>
              revokeInvitation(project.organizationId, invitation.id)
            }
          />
        </TabsContent>

        <TabsContent value="deployments" className="pt-3">
          <ProjectDeploymentsTab
            deployments={projectDeployments}
            releases={projectReleases}
            loading={loading}
            error={deploymentError}
            onRetry={handleRetryDeployments}
          />
        </TabsContent>

        <TabsContent value="settings" className="pt-3">
          <ProjectSettingsTab
            project={project}
            activeRelease={activeRelease}
            canManage={permissions.canManageProject}
            onSave={(input) => updateProject(project.id, input).then(() => fetchReleases(project.id))}
          />
        </TabsContent>

        <TabsContent value="activity" className="pt-3">
          <ProjectActivityTab
            logs={auditLogs}
            loading={auditLoading}
            error={auditError}
            onRetry={() => fetchAudit(project.organizationId)}
          />
        </TabsContent>
      </Tabs>

      <UploadVersionDialog
        open={showUpload}
        onClose={() => setShowUpload(false)}
        projectId={project.id}
        onUploaded={handleUploadCompleted}
      />

      <InviteMemberDialog
        open={showInvite}
        onClose={() => setShowInvite(false)}
        organizationId={project.organizationId}
      />
    </section>
  );
}

function ProjectDetailLoading({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center py-16" role="status">
      <RefreshCw className="mr-2 size-4 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

function ProjectResolutionState({
  title,
  description,
  onBack,
  onRetry,
}: {
  title: string;
  description: string;
  onBack: () => void;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[28rem] flex-col items-center justify-center py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl border bg-muted text-muted-foreground">
        <FolderX className="size-5" />
      </span>
      <h1 className="mt-5 text-xl font-semibold">{title}</h1>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="size-4" />
          {t("projects.backToProjects")}
        </Button>
        {onRetry ? (
          <Button onClick={onRetry}>
            <RefreshCw className="size-4" />
            {t("common.retry")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
