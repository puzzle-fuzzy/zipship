import { Code2, History, Rocket, Settings, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useAuditStore, useAuthStore, useMembersStore, useProjectsStore } from "../stores";
import { getApiBaseUrl } from "../api/client";
import { useTranslation } from "../i18n";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
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

type ProjectDetailTab = "versions" | "members" | "deployments" | "settings" | "activity";

/**
 * Project detail orchestrator: resolves the project from the store, fetches its
 * releases / members / audit trail, and delegates each tab's rendering to a
 * dedicated component. Business actions are passed down as callbacks so the
 * tabs stay presentational and independently testable.
 */
export function ProjectDetailPage() {
  const { t } = useTranslation();
  const { projectId } = useParams();
  const { user, refreshToken } = useAuthStore();
  const {
    projects,
    releases,
    releaseErrors,
    deployments,
    deploymentErrors,
    fetchReleases,
    fetchDeployments,
    publishRelease,
    rollbackRelease,
    deleteProject,
    updateProject,
  } = useProjectsStore();
  const { members, fetchMembers, loading: membersLoading, updateMemberRole, removeMember } =
    useMembersStore();
  const { logs: auditLogs, loading: auditLoading, error: auditError, fetchAudit } =
    useAuditStore();
  const [showUpload, setShowUpload] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ProjectDetailTab>("versions");
  const [pendingUploadAnchorId, setPendingUploadAnchorId] = useState<string | null | undefined>(undefined);
  const [highlightedReleaseId, setHighlightedReleaseId] = useState<string | null>(null);

  const project = projects.find((p) => p.id === projectId) ?? null;
  const projectReleases = projectId ? releases[projectId] ?? [] : [];
  const releaseError = projectId ? releaseErrors[projectId] ?? null : null;
  const projectDeployments = projectId ? deployments[projectId] ?? [] : [];
  const deploymentError = projectId ? deploymentErrors[projectId] ?? null : null;
  const { releasePollingEnabled, startReleasePolling } = useProjectReleasePolling({
    projectId,
    refreshToken,
    releases: projectReleases,
    fetchReleases,
  });

  useEffect(() => {
    if (projectId && refreshToken) {
      fetchReleases(projectId).finally(() => setLoading(false));
      fetchDeployments(projectId);
    }
  }, [projectId, refreshToken]);

  useEffect(() => {
    if (project && refreshToken) {
      fetchMembers(project.organizationId);
      fetchAudit(project.organizationId);
    }
  }, [projectId, refreshToken]);

  useEffect(() => {
    if (pendingUploadAnchorId === undefined) return;

    const nextHighlightId = findUploadedReleaseHighlight(projectReleases, pendingUploadAnchorId);
    if (!nextHighlightId) return;

    setActiveTab("versions");
    setHighlightedReleaseId(nextHighlightId);
    setPendingUploadAnchorId(undefined);
  }, [pendingUploadAnchorId, projectReleases]);

  if (!project) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  }

  const currentMember = members.find((m) => m.userId === user?.id);
  const permissions = getProjectRolePermissions(currentMember);
  const activeRelease = projectReleases.find((r) => r.status === "active");
  const previewRelease =
    activeRelease ??
    projectReleases.find((release) => release.status === "ready") ??
    projectReleases.find((release) => release.releaseHash) ??
    null;
  const previewUrl = previewRelease
    ? buildSitePreviewUrl(getApiBaseUrl(), project.slug, previewRelease.releaseHash)
    : null;

  const handlePreview = (release: Release) => {
    window.open(buildSitePreviewUrl(getApiBaseUrl(), project.slug, release.releaseHash), "_blank");
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
            loading={membersLoading}
            canManage={permissions.canManageMembers}
            currentUserId={user?.id ?? null}
            onInviteClick={() => setShowInvite(true)}
            onChangeRole={(member, role) =>
              updateMemberRole(project.organizationId, member.userId, role)
            }
            onRemove={(member) => removeMember(project.organizationId, member.userId)}
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
            onDelete={() => deleteProject(project.id)}
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
