import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useTranslation } from "../../i18n";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "../../components/ui/card";
import { Checkbox } from "../../components/ui/checkbox";
import { Input } from "../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import type { Project, Release } from "../../stores/projectsStore";

interface ProjectSettingsTabProps {
  project: Project;
  activeRelease: Release | undefined;
  canManage: boolean;
  /** Persist the edit; resolves on success, rejects on failure. The tab toasts. */
  onSave: (input: { name: string; slug: string; description: string | null }) => Promise<void>;
  /** Delete the project; resolves on success, rejects on failure. The tab toasts + navigates. */
  onDelete: () => Promise<void>;
}

export function ProjectSettingsTab({
  project,
  activeRelease,
  canManage,
  onSave,
  onDelete,
}: ProjectSettingsTabProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [editingName, setEditingName] = useState(project.name);
  const [editingSlug, setEditingSlug] = useState(project.slug);
  const [editingDesc, setEditingDesc] = useState(project.description ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Re-seed the form if a different project mounts into the same instance.
  useEffect(() => {
    setEditingName(project.name);
    setEditingSlug(project.slug);
    setEditingDesc(project.description ?? "");
  }, [project.id]);

  const handleDelete = async () => {
    if (!confirm(t("toast.deleteProjectConfirm", { name: project.name }))) return;
    setDeleting(true);
    try {
      await onDelete();
      toast.success(t("toast.projectDeleted"));
      navigate("/app");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toast.deleteFailed"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardDescription>{t("settings.projectPreferences")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!canManage) return;
            setSaving(true);
            try {
              await onSave({
                name: editingName,
                slug: editingSlug,
                description: editingDesc || null,
              });
              toast.success(t("toast.settingsSaved"));
            } catch (err) {
              toast.error(err instanceof Error ? err.message : t("toast.saveFailed"));
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
                    <SelectItem value="path">{t("settings.routingPath")}</SelectItem>
                    <SelectItem value="hash">{t("settings.routingHash")}</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </label>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t("settings.deployUrl")}</span>
            {activeRelease ? (
              <code className="w-fit rounded-md bg-muted px-2 py-1 font-mono text-xs">
                /{project.slug}/{activeRelease.releaseHash}/
              </code>
            ) : (
              <span className="text-sm text-muted-foreground">{t("settings.noDeployed")}</span>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 pt-2">
            <Button
              type="button"
              variant="destructive"
              disabled={!canManage || deleting}
              onClick={handleDelete}
            >
              {deleting ? t("toast.deleting") : t("settings.deleteProject")}
            </Button>
            <Button type="submit" disabled={!canManage || saving}>
              {saving ? t("toast.saving") : t("common.save")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
