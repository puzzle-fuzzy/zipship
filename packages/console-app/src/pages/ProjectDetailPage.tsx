import { Code2, History, Plus, Settings, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useAuditStore, useAuthStore, useMembersStore, useProjectsStore } from "../stores";
import { getApiBaseUrl } from "../api/client";
import { useTranslation } from "../i18n";
import { Button } from "../components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { InviteMemberDialog } from "../features/members/InviteMemberDialog";
import { UploadVersionDialog } from "../features/versions/UploadVersionDialog";
import { ProjectActivityTab } from "../features/project-detail/ProjectActivityTab";
import { ProjectMembersTab } from "../features/project-detail/ProjectMembersTab";
import { ProjectSettingsTab } from "../features/project-detail/ProjectSettingsTab";
import { ProjectVersionsTab } from "../features/project-detail/ProjectVersionsTab";
import type { Release } from "../stores/projectsStore";

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
  const { projects, releases, fetchReleases, publishRelease, deleteProject, updateProject } =
    useProjectsStore();
  const { members, fetchMembers, loading: membersLoading, updateMemberRole, removeMember } =
    useMembersStore();
  const { logs: auditLogs, loading: auditLoading, error: auditError, fetchAudit } =
    useAuditStore();
  const [showUpload, setShowUpload] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [loading, setLoading] = useState(true);

  const project = projects.find((p) => p.id === projectId) ?? null;
  const projectReleases = projectId ? releases[projectId] ?? [] : [];

  useEffect(() => {
    if (projectId && refreshToken) {
      fetchReleases(projectId).finally(() => setLoading(false));
    }
  }, [projectId, refreshToken]);

  useEffect(() => {
    if (project && refreshToken) {
      fetchMembers(project.organizationId);
      fetchAudit(project.organizationId);
    }
  }, [projectId, refreshToken]);

  if (!project) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  }

  const currentMember = members.find((m) => m.userId === user?.id);
  const canManage = currentMember?.role === "owner" || currentMember?.role === "admin";
  const activeRelease = projectReleases.find((r) => r.status === "active");

  const handlePreview = (release: Release) => {
    const base = getApiBaseUrl().replace(/\/+$/, "");
    window.open(`${base}/_sites/${project.slug}/${release.releaseHash}/`, "_blank");
  };

  return (
    <section className="flex flex-col gap-4 py-6">
      {/* ─── Project Header ─── */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          <p className="text-sm text-muted-foreground">/{project.slug}</p>
        </div>
        <Button onClick={() => setShowUpload(true)}>
          <Plus className="size-4" />
          {t("toast.publishVersion")}
        </Button>
      </div>

      <Tabs defaultValue="versions">
        <TabsList variant="line">
          <TabsTrigger value="versions">
            <Code2 className="size-4" />
            {t("versions.title")}
          </TabsTrigger>
          <TabsTrigger value="members">
            <Users className="size-4" />
            {t("members.title")}
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
            canManage={canManage}
            onUploadClick={() => setShowUpload(true)}
            onPreview={handlePreview}
            onPublish={(release) => publishRelease(project.id, release.id)}
          />
        </TabsContent>

        <TabsContent value="members" className="pt-3">
          <ProjectMembersTab
            members={members}
            loading={membersLoading}
            canManage={canManage}
            currentUserId={user?.id ?? null}
            onInviteClick={() => setShowInvite(true)}
            onChangeRole={(member, role) =>
              updateMemberRole(project.organizationId, member.userId, role)
            }
            onRemove={(member) => removeMember(project.organizationId, member.userId)}
          />
        </TabsContent>

        <TabsContent value="settings" className="pt-3">
          <ProjectSettingsTab
            project={project}
            activeRelease={activeRelease}
            canManage={canManage}
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
        onUploaded={() => fetchReleases(project.id)}
      />

      <InviteMemberDialog
        open={showInvite}
        onClose={() => setShowInvite(false)}
        organizationId={project.organizationId}
      />
    </section>
  );
}
