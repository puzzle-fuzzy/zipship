import { Trash2 } from "lucide-react";
import { Badge } from "../../components/primitives/badge";
import { Button } from "../../components/primitives/button";
import { Skeleton } from "../../components/primitives/skeleton";
import { useTranslation } from "../../i18n";
import type { ApiToken } from "./apiTokens";
import { formatTokenDate } from "./apiTokenPresentation";

export function TokenRow({
  token,
  language,
  onRevoke,
}: {
  token: ApiToken;
  language: string;
  onRevoke: () => void;
}) {
  const { t } = useTranslation();
  return (
    <article className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start" role="listitem">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="min-w-0 truncate text-sm font-medium">{token.name}</h3>
          <TokenStateBadge state={token.state} />
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            {token.displayPrefix}…
          </code>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {token.scopes.map((scope) => (
            <Badge key={scope} variant="outline" className="font-mono font-normal">
              {scope}
            </Badge>
          ))}
        </div>
        <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3">
          <div>
            <dt className="inline font-medium text-foreground">
              {t("settings.apiTokenCreatedAt")}:{" "}
            </dt>
            <dd className="inline">{formatTokenDate(token.createdAt, language)}</dd>
          </div>
          <div>
            <dt className="inline font-medium text-foreground">
              {t("settings.apiTokenExpiresAt")}:{" "}
            </dt>
            <dd className="inline">{formatTokenDate(token.expiresAt, language)}</dd>
          </div>
          <div>
            <dt className="inline font-medium text-foreground">
              {t("settings.apiTokenLastUsedAt")}:{" "}
            </dt>
            <dd className="inline">
              {token.lastUsedAt
                ? formatTokenDate(token.lastUsedAt, language)
                : t("settings.apiTokenNeverUsed")}
            </dd>
          </div>
        </dl>
      </div>
      {token.state === "active" ? (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={onRevoke}
        >
          <Trash2 data-icon="inline-start" aria-hidden="true" />
          {t("settings.revokeApiToken")}
        </Button>
      ) : null}
    </article>
  );
}
function TokenStateBadge({ state }: { state: ApiToken["state"] }) {
  const { t } = useTranslation();
  if (state === "active") {
    return (
      <Badge variant="outline">
        {t("settings.apiTokenStateActive")}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary">
      {t(
        state === "expired"
          ? "settings.apiTokenStateExpired"
          : "settings.apiTokenStateRevoked",
      )}
    </Badge>
  );
}

export function TokenListSkeleton() {
  return (
    <div className="divide-y rounded-lg border" aria-hidden="true">
      {[0, 1].map((item) => (
        <div key={item} className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-5 w-28 rounded-full" />
            <Skeleton className="h-5 w-24 rounded-full" />
          </div>
          <Skeleton className="h-3 w-full max-w-md" />
        </div>
      ))}
    </div>
  );
}
