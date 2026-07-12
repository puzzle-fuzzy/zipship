import { ExternalLink, Plus } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useTranslation } from "../../i18n";
import type { Project, Release } from "../../stores/projectsStore";

interface ProjectDetailHeaderProps {
  project: Project;
  activeRelease: Release | undefined;
  canUpload: boolean;
  onOpenActiveRelease: (release: Release) => void;
  onUploadClick: () => void;
}

export function ProjectDetailHeader({
  project,
  activeRelease,
  canUpload,
  onOpenActiveRelease,
  onUploadClick,
}: ProjectDetailHeaderProps) {
  const { t } = useTranslation();

  return (
    <div className="rounded-lg border bg-card/88 shadow-sm">
      <div className="flex flex-col gap-5 p-4 sm:flex-row sm:items-end sm:justify-between sm:p-5">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-md border bg-background px-1.5 py-0.5 font-mono">/{project.slug}</span>
            <span>{activeRelease ? t("versions.status.active") : t("settings.noDeployed")}</span>
          </div>
          <h1 className="truncate text-3xl font-semibold tracking-tight">{project.name}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            {project.description || t("help.noVersions")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {activeRelease && (
            <Button variant="outline" onClick={() => onOpenActiveRelease(activeRelease)}>
              <ExternalLink className="size-4" />
              {t("versions.preview")}
            </Button>
          )}
          <Button disabled={!canUpload} onClick={onUploadClick}>
            <Plus className="size-4" />
            {t("toast.publishVersion")}
          </Button>
        </div>
      </div>
    </div>
  );
}
