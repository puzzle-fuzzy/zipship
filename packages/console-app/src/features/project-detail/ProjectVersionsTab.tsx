import { MoreHorizontal, Plus } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "../../i18n";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { Separator } from "../../components/ui/separator";
import type { Release } from "../../stores/projectsStore";
import { releaseStatusBadgeClass, releaseStatusLabel } from "./releaseStatus";

interface ProjectVersionsTabProps {
  releases: Release[];
  loading: boolean;
  canManage: boolean;
  onUploadClick: () => void;
  onPreview: (release: Release) => void;
  /** Perform the publish; resolves on success, rejects on failure. The tab toasts. */
  onPublish: (release: Release) => Promise<void>;
}

export function ProjectVersionsTab({
  releases,
  loading,
  canManage,
  onUploadClick,
  onPreview,
  onPublish,
}: ProjectVersionsTabProps) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        {t("common.loading")}
      </div>
    );
  }

  if (releases.length === 0) {
    return (
      <div className="rounded-xl flex flex-col gap-2 border border-dashed p-8 text-center text-sm text-muted-foreground">
        <div>{t("versions.empty")}</div>
        <div>
          <Button onClick={onUploadClick}>
            <Plus className="size-4" />
            {t("toast.publishVersion")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card">
      {releases.map((release, index) => (
        <div key={release.id}>
          <div className="flex w-full items-center justify-between gap-4 px-3 py-3.5">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="shrink-0 text-xs font-medium text-muted-foreground">Ver.</span>
              <span className="truncate font-mono text-xs tracking-tight">
                v{release.versionNumber}
                {release.releaseHash && (
                  <span className="text-muted-foreground ml-1">({release.releaseHash})</span>
                )}
              </span>
              <span
                className={`inline-flex shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-none ${releaseStatusBadgeClass(release.status)}`}
              >
                {releaseStatusLabel(release.status, t)}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>{t("versions.files", { count: release.fileCount })}</span>
              <span>·</span>
              <span>{t("versions.size", { size: Math.round(release.totalSize / 1024) })}</span>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
                  <MoreHorizontal className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" sideOffset={6} className="min-w-40">
                  <DropdownMenuItem onClick={() => onPreview(release)}>
                    {t("versions.preview")}
                  </DropdownMenuItem>
                  {release.status !== "active" && (
                    <DropdownMenuItem
                      disabled={!canManage}
                      onClick={async () => {
                        try {
                          await onPublish(release);
                          toast.success(t("toast.published"));
                        } catch (err) {
                          toast.error(
                            err instanceof Error ? err.message : t("toast.publishFailed"),
                          );
                        }
                      }}
                    >
                      {t("versions.publish")}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    disabled={!canManage}
                    className="text-destructive"
                    onClick={() => toast.info(t("toast.deleteVersionSoon"))}
                  >
                    {t("versions.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          {index < releases.length - 1 && <Separator />}
        </div>
      ))}
    </div>
  );
}
