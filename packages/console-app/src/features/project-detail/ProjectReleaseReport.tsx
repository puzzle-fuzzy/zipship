import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  FileCode2,
  Files,
  Gauge,
  Globe2,
  MonitorCheck,
  Search,
} from "lucide-react";
import { useTranslation } from "../../i18n";
import type { Release } from "../../stores/projectsStore";
import { parseReleaseReport, type ReleaseReportIssue } from "./releaseReport";

interface ProjectReleaseReportProps {
  release: Release;
}

export function ProjectReleaseReport({ release }: ProjectReleaseReportProps) {
  const { t } = useTranslation();
  const report = parseReleaseReport(release.detectResult);
  const warningCount = report.issues.filter((issue) => issue.level === "warning").length;
  const failedCount = report.issues.filter((issue) => issue.level === "failed").length;
  const passedSeoCount = report.seoChecks.filter((check) => check.status === "pass").length;
  const warningSeoCount = report.seoChecks.filter((check) => check.status === "warning").length;
  const adviceFor = (code: string, show: boolean) => (show ? t(`releaseReport.advice.${code}`) : null);

  return (
    <div className="border-t bg-muted/20 p-3">
      <div className="grid gap-3 xl:grid-cols-[1.05fr_1fr]">
        <section className="rounded-lg border bg-card/90 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <StatusPill level={report.level} />
                <span className="rounded-md border bg-background px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                  {release.releaseHash}
                </span>
              </div>
              <h3 className="text-base font-semibold">{t("releaseReport.detailTitle")}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t("releaseReport.detailDesc")}</p>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:min-w-72">
              <Metric label={t("releaseReport.files")} value={report.totalFiles} />
              <Metric label={t("releaseReport.sizeLabel")} value={`${Math.round(report.totalSize / 1024)} KB`} />
              <Metric label={t("releaseReport.seo")} value={report.seoScore ?? "-"} />
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <SummaryCard
              icon={FileCode2}
              title={t("releaseReport.artifact")}
              body={report.entrypoint ?? t("releaseReport.noEntrypoint")}
              meta={t("releaseReport.filesAndSize", {
                count: report.totalFiles,
                size: Math.round(report.totalSize / 1024),
              })}
            />
            <SummaryCard
              icon={Search}
              title={t("releaseReport.seo")}
              body={report.seoScore === null ? t("releaseReport.noSeoScore") : t("releaseReport.seoScore", { score: report.seoScore })}
              meta={t("releaseReport.seoSummary", { passed: passedSeoCount, warnings: warningSeoCount })}
            />
            <SummaryCard
              icon={MonitorCheck}
              title={t("releaseReport.runtime")}
              body={
                report.runtime === null
                  ? t("releaseReport.noRuntime")
                  : t("releaseReport.runtimeLevel", {
                      level: t(`releaseReport.runtimeLevels.${report.runtime.level}`),
                    })
              }
              meta={
                report.runtime?.status === null || report.runtime?.status === undefined
                  ? t("releaseReport.noRuntimeStatus")
                  : t("releaseReport.runtimeHttp", { status: report.runtime.status })
              }
            />
            <SummaryCard
              icon={CircleAlert}
              title={t("releaseReport.issues")}
              body={report.issues.length === 0 ? t("releaseReport.noIssues") : t("releaseReport.issueSummary", { count: report.issues.length })}
              meta={t("releaseReport.issueMeta", { warnings: warningCount, failed: failedCount })}
            />
          </div>
        </section>

        <section className="rounded-lg border bg-card/90 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">{t("releaseReport.checklist")}</h3>
              <p className="text-sm text-muted-foreground">{t("releaseReport.checklistDesc")}</p>
            </div>
            <Gauge className="size-4 text-muted-foreground" />
          </div>

          <div className="grid gap-2">
            {report.seoChecks.length === 0 ? (
              <EmptyLine text={t("releaseReport.noSeoScore")} />
            ) : (
              report.seoChecks.map((check) => (
                <CheckLine
                  key={check.code}
                  level={check.status === "pass" ? "info" : "warning"}
                  text={t(`releaseReport.codes.${check.code}`)}
                  meta={t("releaseReport.seo")}
                  advice={adviceFor(check.code, check.status === "warning")}
                />
              ))
            )}
            {report.runtime?.items.map((issue) => (
              <CheckLine
                key={issue.code}
                level={issue.level}
                text={t(`releaseReport.codes.${issue.code}`)}
                meta={t("releaseReport.runtime")}
                advice={adviceFor(issue.code, issue.level !== "info")}
              />
            ))}
            {report.issues.map((issue) => (
              <CheckLine
                key={issue.code}
                level={issue.level}
                text={t(`releaseReport.codes.${issue.code}`)}
                meta={t("releaseReport.artifact")}
                advice={adviceFor(issue.code, issue.level !== "info")}
              />
            ))}
          </div>
        </section>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <section className="rounded-lg border bg-card/90 p-4">
          <SectionTitle icon={Files} title={t("releaseReport.assetBreakdown")} />
          {report.assetTypes.length === 0 ? (
            <EmptyLine text={t("releaseReport.noAssetBreakdown")} />
          ) : (
            <div className="mt-3 space-y-2">
              {report.assetTypes.slice(0, 6).map((asset) => (
                <div key={asset.type} className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2 text-sm">
                  <span className="truncate">{t(`releaseReport.assetTypes.${asset.type}`)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {asset.count} / {Math.round(asset.totalSize / 1024)} KB
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-lg border bg-card/90 p-4">
          <SectionTitle icon={FileCode2} title={t("releaseReport.largestFiles")} />
          {report.largestFiles.length === 0 ? (
            <EmptyLine text={t("releaseReport.noLargestFiles")} />
          ) : (
            <div className="mt-3 space-y-2">
              {report.largestFiles.slice(0, 5).map((file) => (
                <div key={file.path} className="rounded-lg border bg-muted/20 px-3 py-2 text-sm">
                  <div className="truncate font-mono text-xs">{file.path}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{Math.round(file.size / 1024)} KB</div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-lg border bg-card/90 p-4">
          <SectionTitle icon={Globe2} title={t("releaseReport.htmlMetadata")} />
          <div className="mt-3 space-y-2">
            <MetadataLine label={t("releaseReport.title")} value={report.htmlTitle} />
            <MetadataLine label={t("releaseReport.description")} value={report.htmlDescription} />
            <MetadataLine label={t("releaseReport.language")} value={report.htmlLang} />
            {report.runtime ? (
              <>
                <MetadataLine label={t("releaseReport.runtimeHttpLabel")} value={report.runtime.status?.toString() ?? null} />
                <MetadataLine label={t("releaseReport.runtimeConsoleLabel")} value={String(report.runtime.consoleErrorCount)} />
                <MetadataLine label={t("releaseReport.runtimeFailedLabel")} value={String(report.runtime.failedRequestCount)} />
              </>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function StatusPill({ level }: { level: "pass" | "warning" | "failed" | "unknown" }) {
  const { t } = useTranslation();
  const className =
    level === "pass"
      ? "border-green-500/25 bg-green-500/10 text-green-700"
      : level === "failed"
        ? "border-destructive/25 bg-destructive/10 text-destructive"
        : level === "warning"
          ? "border-amber-500/25 bg-amber-500/10 text-amber-700"
          : "border-border bg-muted text-muted-foreground";

  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium ${className}`}>
      {level === "unknown" ? t("releaseReport.unknown") : t(`releaseReport.runtimeLevels.${level}`)}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold">{value}</div>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  title,
  body,
  meta,
}: {
  icon: typeof FileCode2;
  title: string;
  body: string;
  meta: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-lg border bg-muted/20 p-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <div className="font-medium">{title}</div>
        <div className="truncate text-sm text-muted-foreground">{body}</div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{meta}</div>
      </div>
    </div>
  );
}

function CheckLine({
  level,
  text,
  meta,
  advice,
}: {
  level: ReleaseReportIssue["level"];
  text: string;
  meta: string;
  advice?: string | null;
}) {
  const { t } = useTranslation();
  const icon =
    level === "failed" ? (
      <CircleAlert className="size-4 text-destructive" />
    ) : level === "warning" ? (
      <AlertTriangle className="size-4 text-amber-600" />
    ) : (
      <CheckCircle2 className="size-4 text-green-600" />
    );

  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0">{icon}</span>
          <span className="truncate">{text}</span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>
      </div>
      {advice ? (
        <div className="mt-2 border-l-2 border-border pl-3 text-xs leading-5 text-muted-foreground">
          <span className="font-medium text-foreground">{t("releaseReport.fixHint")}</span>{" "}
          {advice}
        </div>
      ) : null}
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed bg-muted/10 px-3 py-2 text-sm text-muted-foreground">{text}</div>;
}

function SectionTitle({ icon: Icon, title }: { icon: typeof Files; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-4 text-muted-foreground" />
      <h3 className="font-semibold">{title}</h3>
    </div>
  );
}

function MetadataLine({ label, value }: { label: string; value: string | null }) {
  const { t } = useTranslation();

  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 max-w-[65%] truncate text-right">{value ?? t("releaseReport.missing")}</span>
    </div>
  );
}
