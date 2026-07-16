import { ExternalLink, Monitor, Rocket, Smartphone, UploadCloud } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "../../components/primitives/button";
import { useTranslation } from "../../i18n";
import type { Release } from "../../stores/projectsStore";
import { releaseStatusBadgeClass, releaseStatusLabel } from "./releaseStatus";

type PreviewDevice = "desktop" | "mobile";

interface ProjectPreviewPanelProps {
  release: Release | null;
  previewUrl: string | null;
  canUpload: boolean;
  onOpenPreview: (release: Release) => void;
  onUploadClick: () => void;
}

export function ProjectPreviewPanel({
  release,
  previewUrl,
  canUpload,
  onOpenPreview,
  onUploadClick,
}: ProjectPreviewPanelProps) {
  const { t } = useTranslation();
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const frameWidth = device === "mobile" ? "max-w-[390px]" : "max-w-full";
  const frameTitle = useMemo(
    () => (release ? t("preview.frameTitle", { version: release.versionNumber }) : t("preview.title")),
    [release, t],
  );

  return (
    <section className="overflow-hidden rounded-lg border bg-card/92 shadow-sm">
      <div className="flex flex-col gap-3 border-b bg-muted/20 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">{t("preview.title")}</h2>
            {release ? (
              <span
                className={`inline-flex shrink-0 rounded-md border px-1.5 py-0.5 text-xs font-semibold uppercase leading-none tracking-[0.06em] ${releaseStatusBadgeClass(release.status)}`}
              >
                {releaseStatusLabel(release.status, t)}
              </span>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {release
              ? t("preview.desc", { version: release.versionNumber, hash: release.releaseHash })
              : t("preview.emptyDesc")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border bg-background p-0.5">
            <button
              type="button"
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors ${
                device === "desktop" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setDevice("desktop")}
            >
              <Monitor className="size-4" />
              {t("preview.desktop")}
            </button>
            <button
              type="button"
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors ${
                device === "mobile" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setDevice("mobile")}
            >
              <Smartphone className="size-4" />
              {t("preview.mobile")}
            </button>
          </div>
          {release ? (
            <Button variant="outline" size="sm" className="min-h-10 sm:min-h-7" onClick={() => onOpenPreview(release)}>
              <ExternalLink className="size-4" />
              {t("preview.open")}
            </Button>
          ) : (
            <Button size="sm" className="min-h-10 sm:min-h-7" disabled={!canUpload} onClick={onUploadClick}>
              <UploadCloud className="size-4" />
              {t("preview.upload")}
            </Button>
          )}
        </div>
      </div>

      <div className="bg-background/50 p-3">
        {release && previewUrl ? (
          <div className={`mx-auto overflow-hidden rounded-lg border bg-background shadow-sm transition-[max-width] ${frameWidth}`}>
            <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-3 py-2">
              <div className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-destructive/70" />
                <span className="size-2.5 rounded-full bg-amber-500/70" />
                <span className="size-2.5 rounded-full bg-green-600/70" />
              </div>
              <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{previewUrl}</span>
            </div>
            <iframe
              title={frameTitle}
              src={previewUrl}
              className="h-[420px] w-full bg-background md:h-[520px]"
              sandbox="allow-forms allow-popups allow-same-origin allow-scripts"
            />
          </div>
        ) : (
          <div className="flex min-h-72 flex-col items-center justify-center rounded-lg border border-dashed bg-card/70 p-8 text-center">
            <div className="mb-3 flex size-11 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
              <Rocket className="size-5" />
            </div>
            <h3 className="font-semibold">{t("preview.emptyTitle")}</h3>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              {canUpload ? t("preview.emptyHelp") : t("preview.noUploadPermission")}
            </p>
            <Button className="mt-4" disabled={!canUpload} onClick={onUploadClick}>
              <UploadCloud className="size-4" />
              {t("preview.upload")}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
