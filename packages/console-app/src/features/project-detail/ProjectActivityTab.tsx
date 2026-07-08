import { useTranslation } from "../../i18n";
import { Button } from "../../components/ui/button";
import type { AuditLogEntry } from "../../stores/auditStore";

interface ProjectActivityTabProps {
  logs: AuditLogEntry[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

export function ProjectActivityTab({ logs, loading, error, onRetry }: ProjectActivityTabProps) {
  const { t } = useTranslation();

  return (
    <div className="rounded-xl border bg-card">
      {loading ? (
        <div className="p-8 text-center text-sm text-muted-foreground">{t("common.loading")}</div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 p-8 text-center text-sm text-muted-foreground">
          <span className="text-destructive">{t("activity.error")}</span>
          <Button variant="outline" size="sm" onClick={onRetry}>
            {t("activity.retry")}
          </Button>
        </div>
      ) : logs.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">{t("activity.empty")}</div>
      ) : (
        logs.map((log) => (
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
  );
}
