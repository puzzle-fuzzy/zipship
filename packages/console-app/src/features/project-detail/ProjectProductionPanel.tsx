import { Copy, ExternalLink, Globe2, RadioTower, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { useTranslation } from "../../i18n";
import type { Release } from "../../stores/projectsStore";
import { buildProductionUrls } from "./projectProductionUrls";
import { getAccessPlaneBaseUrl } from "../../api/client";
import { parseReleaseReport, summarizeReleaseGate } from "./releaseReport";

interface ProjectProductionPanelProps {
  projectSlug: string;
  activeRelease: Release | undefined;
  canUpload: boolean;
  onUploadClick: () => void;
}

export function ProjectProductionPanel({
  projectSlug,
  activeRelease,
  canUpload,
  onUploadClick,
}: ProjectProductionPanelProps) {
  const { t } = useTranslation();
  const urls = activeRelease
    ? buildProductionUrls(getAccessPlaneBaseUrl(), projectSlug, activeRelease.id)
    : null;
  const gate = activeRelease ? summarizeReleaseGate(parseReleaseReport(activeRelease.detectResult)) : null;

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("production.copied"));
    } catch {
      toast.error(t("production.copyFailed"));
    }
  };

  return (
    <section className="overflow-hidden rounded-lg border bg-card/92 shadow-sm">
      <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-lg border bg-primary/10 text-primary">
              <RadioTower className="size-4" />
            </span>
            <div>
              <h2 className="font-semibold">{t("production.title")}</h2>
              <p className="text-sm text-muted-foreground">
                {activeRelease ? t("production.liveDesc") : t("production.emptyDesc")}
              </p>
            </div>
          </div>
          {activeRelease && urls ? (
            <div className="mt-3 grid gap-2">
              <UrlLine
                label={t("production.liveUrl")}
                url={urls.liveUrl}
                copyLabel={t("production.copyLiveUrl")}
                onCopy={() => copyUrl(urls.liveUrl)}
              />
              <UrlLine
                label={t("production.pinnedUrl")}
                url={urls.pinnedUrl}
                copyLabel={t("production.copyPinnedUrl")}
                onCopy={() => copyUrl(urls.pinnedUrl)}
              />
            </div>
          ) : null}
        </div>

        <div className="grid min-w-0 gap-3 sm:grid-cols-3 lg:min-w-[25rem]">
          <ProductionMetric
            label={t("production.current")}
            value={activeRelease ? `v${activeRelease.versionNumber}` : "-"}
          />
          <ProductionMetric
            label={t("production.quality")}
            value={gate ? (gate.level === "unknown" ? t("releaseReport.unknown") : t(`releaseReport.runtimeLevels.${gate.level}`)) : "-"}
          />
          <ProductionMetric
            label={t("production.files")}
            value={activeRelease ? t("versions.files", { count: activeRelease.fileCount }) : "-"}
          />
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {activeRelease ? (
            <>
              <Badge variant="outline" className="rounded-md">
                {t("versions.status.active")}
              </Badge>
              <span className="min-w-0 truncate font-mono text-xs">{activeRelease.releaseHash}</span>
            </>
          ) : (
            <span>{t("production.emptyAction")}</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {activeRelease && urls ? (
            <Button variant="outline" size="sm" onClick={() => window.open(urls.liveUrl, "_blank")}>
              <ExternalLink className="size-4" />
              {t("production.open")}
            </Button>
          ) : null}
          <Button size="sm" disabled={!canUpload} onClick={onUploadClick}>
            <UploadCloud className="size-4" />
            {t("production.upload")}
          </Button>
        </div>
      </div>
    </section>
  );
}

function UrlLine({
  label,
  url,
  copyLabel,
  onCopy,
}: {
  label: string;
  url: string;
  copyLabel: string;
  onCopy: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border bg-background/70 px-2 py-1.5">
      <Globe2 className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-xs">{url}</span>
      <Button variant="ghost" size="icon-sm" className="size-7 shrink-0" aria-label={copyLabel} onClick={onCopy}>
        <Copy className="size-3.5" />
      </Button>
    </div>
  );
}

function ProductionMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border bg-muted/25 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold">{value}</div>
    </div>
  );
}
