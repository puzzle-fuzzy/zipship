import { Code2, History, MoreHorizontal, Plus, Settings, UserPlus, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { useAuditStore, useAuthStore, useMembersStore, useProjectsStore } from "../stores";
import { getApiBaseUrl } from "../api/client";
import { useTranslation } from "../i18n";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Checkbox } from "../components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Separator } from "../components/ui/separator";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs";
import { Textarea } from "../components/ui/textarea";
import { InviteMemberDialog } from "../features/members/InviteMemberDialog";
import { UploadVersionDialog } from "../features/versions/UploadVersionDialog";

export function ProjectDetailPage() {
  const { t } = useTranslation();
  const { projectId } = useParams();
  const { user, refreshToken } = useAuthStore();
  const { projects, releases, fetchReleases, publishRelease, deleteProject, updateProject } = useProjectsStore();
  const { members, fetchMembers, loading: membersLoading } = useMembersStore();
  const { logs: auditLogs, loading: auditLoading, error: auditError, fetchAudit } = useAuditStore();
  const navigate = useNavigate();
  const [showUpload, setShowUpload] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingName, setEditingName] = useState("");
  const [editingSlug, setEditingSlug] = useState("");
  const [editingDesc, setEditingDesc] = useState("");
  const [saving, setSaving] = useState(false);

  const project = projects.find((p) => p.id === projectId) ?? null;
  const projectReleases = projectId ? (releases[projectId] ?? []) : [];
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (projectId && refreshToken) {
      fetchReleases(projectId).finally(() =>
        setLoading(false),
      );
    }
  }, [projectId, refreshToken]);

  useEffect(() => {
    if (project && refreshToken) {
      fetchMembers(project.organizationId);
      fetchAudit(project.organizationId);
    }
  }, [projectId, refreshToken]);

  useEffect(() => {
    if (project) {
      setEditingName(project.name);
      setEditingSlug(project.slug);
      setEditingDesc(project.description ?? "");
    }
  }, [project?.id]);

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

  const statusLabel = (status: string) => {
    const map: Record<string, string> = {
      active: t("versions.status.active"),
      ready: t("versions.status.ready"),
      uploading: t("versions.status.uploading"),
      processing: t("versions.status.processing"),
      failed: t("versions.status.failed"),
      archived: t("versions.status.archived"),
      deleted: t("versions.status.deleted"),
    };
    return map[status] ?? status;
  };

  const statusBadgeClass = (status: string) => {
    switch (status) {
      case "active":
        return "border-primary/20 bg-primary/10 text-primary";
      case "ready":
        return "border-border bg-muted text-muted-foreground";
      case "failed":
        return "border-destructive/30 bg-destructive/10 text-destructive";
      case "archived":
      case "deleted":
        return "border-border bg-background text-muted-foreground";
      default:
        return "border-border bg-background text-muted-foreground";
    }
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
          {t('toast.publishVersion')}
        </Button>
      </div>

      {/* ─── Tabs (line variant, with icons) ─── */}
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

        {/* ────── Versions Tab ────── */}
        <TabsContent value="versions" className="pt-3">
          {loading ? (
            <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              {t("common.loading")}
            </div>
          ) : projectReleases.length === 0 ? (
            <div className="rounded-xl flex flex-col gap-2 border border-dashed p-8 text-center text-sm text-muted-foreground">
              <div>{t("versions.empty")}</div>
              <div>
                <Button onClick={() => setShowUpload(true)}>
                  <Plus className="size-4" />
                  {t('toast.publishVersion')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border bg-card">
              {projectReleases.map((release, index) => (
                <div key={release.id}>
                  <div className="flex w-full items-center justify-between gap-4 px-3 py-3.5">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="shrink-0 text-xs font-medium text-muted-foreground">
                        Ver.
                      </span>
                      <span className="truncate font-mono text-xs tracking-tight">
                        v{release.versionNumber}
                        {release.releaseHash && (
                          <span className="text-muted-foreground ml-1">
                            ({release.releaseHash})
                          </span>
                        )}
                      </span>
                      <span
                        className={`inline-flex shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-none ${statusBadgeClass(release.status)}`}
                      >
                        {statusLabel(release.status)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>
                        {t("versions.files", { count: release.fileCount })}
                      </span>
                      <span>·</span>
                      <span>
                        {t("versions.size", {
                          size: Math.round(release.totalSize / 1024),
                        })}
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={<Button variant="ghost" size="icon-sm" />}
                        >
                          <MoreHorizontal className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          sideOffset={6}
                          className="min-w-40"
                        >
                          <DropdownMenuItem onClick={() => {
                            const base = getApiBaseUrl().replace(/\/+$/, '');
                            const url = `${base}/_sites/${project.slug}/${release.releaseHash}/`;
                            window.open(url, '_blank');
                          }}>
                            {t("versions.preview")}
                          </DropdownMenuItem>
                          {release.status !== "active" && (
                            <DropdownMenuItem
                              disabled={!canManage}
                              onClick={async () => {
                                try {
                                  await publishRelease(project.id, release.id);
                                  toast.success(t('toast.published'));
                                } catch (err) {
                                  toast.error(err instanceof Error ? err.message : t('toast.publishFailed'));
                                }
                              }}
                            >
                              {t("versions.publish")}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            disabled={!canManage}
                            className="text-destructive"
                            onClick={() => {
                              toast.info(t('toast.deleteVersionSoon'));
                            }}
                          >
                            {t("versions.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  {index < projectReleases.length - 1 && <Separator />}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ────── Members Tab ────── */}
        <TabsContent value="members" className="pt-3">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between w-full">
                <div>
                  <CardTitle>{t("members.title")}</CardTitle>
                  <CardDescription>{t("members.inviteDesc")}</CardDescription>
                </div>
                <Button size="sm" onClick={() => setShowInvite(true)}>
                  <UserPlus className="size-4" />
                  {t("members.invite")}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {membersLoading ? (
                <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                  {t("common.loading")}
                </div>
              ) : members.length === 0 ? (
                <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                  {t("members.empty")}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {members.map((member) => (
                    <div
                      key={member.id}
                      className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                          {member.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">
                            {member.name}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {member.email}
                          </div>
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs">
                        {t(`members.${member.role}`)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ────── Settings Tab ────── */}
        <TabsContent value="settings" className="pt-3">
          <Card>
            <CardHeader>
              <CardDescription>调整项目偏好</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="flex flex-col gap-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!canManage) return;
                  setSaving(true);
                  try {
                    await updateProject(project.id, {
                      name: editingName,
                      slug: editingSlug,
                      description: editingDesc || null,
                    });
                    await fetchReleases(project.id);
                    toast.success(t('toast.settingsSaved'));
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : t('toast.saveFailed'));
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="flex flex-col gap-1.5 text-sm font-medium">
                    {t("projects.name")}
                    <Input
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      disabled={!canManage}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm font-medium">
                    {t("projects.slug")}
                    <Input
                      value={editingSlug}
                      onChange={(e) => setEditingSlug(e.target.value)}
                      className="font-mono"
                      disabled={!canManage}
                    />
                  </label>
                </div>

                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  {t("projects.description")}
                  <Textarea
                    value={editingDesc}
                    onChange={(e) => setEditingDesc(e.target.value)}
                    placeholder={t("projects.descriptionPlaceholder")}
                    className="field-sizing-fixed"
                    rows={4}
                    disabled={!canManage}
                  />
                </label>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <Checkbox defaultChecked={false} disabled={!canManage} />
                    {t("settings.spaMode")}
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm font-medium">
                    {t("settings.routingType")}
                    <Select defaultValue="path" disabled={!canManage}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="path">
                            {t("settings.routingPath")}
                          </SelectItem>
                          <SelectItem value="hash">
                            {t("settings.routingHash")}
                          </SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </label>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">
                    {t("settings.deployUrl")}
                  </span>
                  {activeRelease ? (
                    <code className="w-fit rounded-md bg-muted px-2 py-1 font-mono text-xs">
                      /{project.slug}/{activeRelease.releaseHash}/
                    </code>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      {t("settings.noDeployed")}
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 pt-2">
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={!canManage || deleting}
                    onClick={async () => {
                      if (!confirm(t('toast.deleteProjectConfirm', { name: project.name }))) return;
                      setDeleting(true);
                      try {
                        await deleteProject(project.id);
                        toast.success(t('toast.projectDeleted'));
                        navigate('/app');
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : t('toast.deleteFailed'));
                      } finally {
                        setDeleting(false);
                      }
                    }}
                  >
                    {deleting ? t('toast.deleting') : t("settings.deleteProject")}
                  </Button>
                  <Button type="submit" disabled={!canManage || saving}>
                    {saving ? t('toast.saving') : t("common.save")}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ────── Activity Tab (org audit trail) ────── */}
        <TabsContent value="activity" className="pt-3">
          <div className="rounded-xl border bg-card">
            {auditLoading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                {t("common.loading")}
              </div>
            ) : auditError ? (
              <div className="flex flex-col items-center gap-3 p-8 text-center text-sm text-muted-foreground">
                <span className="text-destructive">{t("activity.error")}</span>
                <Button variant="outline" size="sm" onClick={() => fetchAudit(project.organizationId)}>
                  {t("activity.retry")}
                </Button>
              </div>
            ) : auditLogs.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                {t("activity.empty")}
              </div>
            ) : (
              auditLogs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-center justify-between gap-4 border-b px-3 py-3.5 last:border-b-0"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate font-mono text-xs">{log.action}</span>
                    <span className="text-xs text-muted-foreground">
                      {log.targetType}
                      {log.targetId ? ` · ${log.targetId.slice(0, 8)}` : ""}
                    </span>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {new Date(log.createdAt).toLocaleString()}
                  </span>
                </div>
              ))
            )}
          </div>
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
