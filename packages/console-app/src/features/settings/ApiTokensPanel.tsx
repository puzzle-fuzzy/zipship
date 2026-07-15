import {
  Check,
  Copy,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { getThrownApiErrorCode } from "../../api/errors";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../../components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Skeleton } from "../../components/ui/skeleton";
import { useTranslation } from "../../i18n";
import {
  createApiToken,
  listApiTokens,
  revokeApiToken,
  type ApiToken,
  type ApiTokenScope,
} from "./apiTokens";

const TOKEN_SCOPES: ApiTokenScope[] = [
  "projects:read",
  "releases:read",
  "uploads:write",
  "deployments:write",
];

const EXPIRATION_OPTIONS = [7, 30, 90, 365] as const;

export function ApiTokensPanel() {
  const { t, language } = useTranslation();
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<ApiToken | null>(null);
  const [revoking, setRevoking] = useState(false);
  const loadSequence = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setLoadError(null);
    try {
      const nextTokens = await listApiTokens();
      if (sequence !== loadSequence.current) return;
      setTokens(nextTokens);
    } catch (error) {
      if (sequence !== loadSequence.current) return;
      setLoadError(error);
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      loadSequence.current += 1;
    };
  }, [load]);

  const handleCreated = (token: ApiToken) => {
    setTokens((current) => [token, ...current.filter((item) => item.id !== token.id)]);
  };

  const handleRevoke = async (event: React.MouseEvent) => {
    event.preventDefault();
    if (!pendingRevoke || revoking) return;
    setRevoking(true);
    try {
      await revokeApiToken(pendingRevoke.id);
      setTokens((current) =>
        current.map((token) =>
          token.id === pendingRevoke.id
            ? { ...token, state: "revoked" }
            : token,
        ),
      );
      setPendingRevoke(null);
      toast.success(t("settings.apiTokenRevoked"));
    } catch (error) {
      toast.error(tokenErrorMessage(error, t, "settings.apiTokenRevokeFailed"));
    } finally {
      setRevoking(false);
    }
  };

  return (
    <section aria-labelledby="api-tokens-heading" className="min-w-0 space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id="api-tokens-heading" className="text-base font-medium">
            {t("settings.apiTokens")}
          </h2>
          <p className="mt-1 max-w-[65ch] text-sm text-muted-foreground">
            {t("settings.apiTokensDescription")}
          </p>
        </div>
        <Button className="self-start" onClick={() => setCreateOpen(true)}>
          <Plus data-icon="inline-start" aria-hidden="true" />
          {t("settings.createApiToken")}
        </Button>
      </div>

      <Alert>
        <ShieldCheck aria-hidden="true" />
        <AlertTitle>{t("settings.apiTokenSecurityTitle")}</AlertTitle>
        <AlertDescription>{t("settings.apiTokenSecurityDesc")}</AlertDescription>
      </Alert>

      {loading ? (
        <TokenListSkeleton />
      ) : loadError ? (
        <Alert variant="destructive">
          <AlertTitle>{t("settings.apiTokensLoadErrorTitle")}</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              {tokenErrorMessage(
                loadError,
                t,
                "settings.apiTokensLoadFailed",
              )}
            </p>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw data-icon="inline-start" aria-hidden="true" />
              {t("common.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : tokens.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <KeyRound aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>{t("settings.apiTokensEmpty")}</EmptyTitle>
            <EmptyDescription>{t("settings.apiTokensEmptyDesc")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => setCreateOpen(true)}>
              <Plus data-icon="inline-start" aria-hidden="true" />
              {t("settings.createApiToken")}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="divide-y rounded-lg border" role="list">
          {tokens.map((token) => (
            <TokenRow
              key={token.id}
              token={token}
              language={language}
              onRevoke={() => setPendingRevoke(token)}
            />
          ))}
        </div>
      )}

      <CreateApiTokenDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
      />

      <AlertDialog
        open={Boolean(pendingRevoke)}
        onOpenChange={(open) => {
          if (!open && !revoking) setPendingRevoke(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings.revokeApiTokenTitle", {
                name: pendingRevoke?.name ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.revokeApiTokenDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={revoking}
              onClick={handleRevoke}
            >
              {revoking
                ? t("settings.revokingApiToken")
                : t("settings.revokeApiToken")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function TokenRow({
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
            <dd className="inline">{formatDate(token.createdAt, language)}</dd>
          </div>
          <div>
            <dt className="inline font-medium text-foreground">
              {t("settings.apiTokenExpiresAt")}:{" "}
            </dt>
            <dd className="inline">{formatDate(token.expiresAt, language)}</dd>
          </div>
          <div>
            <dt className="inline font-medium text-foreground">
              {t("settings.apiTokenLastUsedAt")}:{" "}
            </dt>
            <dd className="inline">
              {token.lastUsedAt
                ? formatDate(token.lastUsedAt, language)
                : t("settings.apiTokenNeverUsed")}
            </dd>
          </div>
        </dl>
      </div>
      {token.state === "active" ? (
        <Button
          variant="ghost"
          size="sm"
          className="self-start text-muted-foreground hover:text-destructive"
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
      <Badge
        variant="outline"
        className="border-green-600/25 bg-green-500/10 text-green-700 dark:text-green-400"
      >
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

function CreateApiTokenDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (token: ApiToken) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [scopes, setScopes] = useState<ApiTokenScope[]>([]);
  const [nameError, setNameError] = useState("");
  const [scopesError, setScopesError] = useState("");
  const [creating, setCreating] = useState(false);
  const [issued, setIssued] = useState<Awaited<ReturnType<typeof createApiToken>> | null>(null);
  const [copied, setCopied] = useState(false);

  const resetAndClose = () => {
    if (creating) return;
    setName("");
    setExpiresInDays(30);
    setScopes([]);
    setNameError("");
    setScopesError("");
    setIssued(null);
    setCopied(false);
    onClose();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedName = name.trim();
    const nextNameError = normalizedName ? "" : t("settings.apiTokenNameRequired");
    const nextScopesError = scopes.length > 0 ? "" : t("settings.apiTokenScopesRequired");
    setNameError(nextNameError);
    setScopesError(nextScopesError);
    if (nextNameError || nextScopesError) return;

    setCreating(true);
    try {
      const result = await createApiToken({
        name: normalizedName,
        scopes,
        expiresInDays,
      });
      setIssued(result);
      onCreated(result.apiToken);
    } catch (error) {
      toast.error(tokenErrorMessage(error, t, "settings.apiTokenCreateFailed"));
    } finally {
      setCreating(false);
    }
  };

  const toggleScope = (scope: ApiTokenScope, checked: boolean) => {
    setScopes((current) =>
      checked
        ? [...current, scope]
        : current.filter((value) => value !== scope),
    );
    if (scopesError) setScopesError("");
  };

  const copySecret = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.secret);
      setCopied(true);
      toast.success(t("settings.apiTokenCopied"));
    } catch {
      toast.error(t("settings.apiTokenCopyFailed"));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) resetAndClose();
      }}
    >
      <DialogContent
        className="sm:max-w-lg"
        showCloseButton={!creating}
        closeLabel={t("common.close")}
      >
        {issued ? (
          <div aria-live="polite">
            <DialogHeader>
              <DialogTitle>{t("settings.apiTokenCreatedTitle")}</DialogTitle>
              <DialogDescription>{t("settings.apiTokenCreatedDesc")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <Alert>
                <ShieldCheck aria-hidden="true" />
                <AlertTitle>{t("settings.apiTokenOneTimeTitle")}</AlertTitle>
                <AlertDescription>{t("settings.apiTokenOneTimeDesc")}</AlertDescription>
              </Alert>
              <div className="rounded-lg border bg-muted/50 p-3">
                <code
                  className="block select-all break-all font-mono text-xs leading-5"
                  aria-label={t("settings.apiTokenSecretLabel")}
                >
                  {issued.secret}
                </code>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => void copySecret()}>
                {copied ? (
                  <Check data-icon="inline-start" aria-hidden="true" />
                ) : (
                  <Copy data-icon="inline-start" aria-hidden="true" />
                )}
                {copied
                  ? t("settings.apiTokenCopied")
                  : t("settings.copyApiToken")}
              </Button>
              <Button type="button" onClick={resetAndClose}>
                {t("common.done")}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>{t("settings.createApiToken")}</DialogTitle>
              <DialogDescription>{t("settings.createApiTokenDesc")}</DialogDescription>
            </DialogHeader>
            <FieldGroup className="py-4">
              <Field data-invalid={Boolean(nameError)}>
                <FieldLabel htmlFor="api-token-name">
                  {t("settings.apiTokenName")}
                </FieldLabel>
                <Input
                  id="api-token-name"
                  value={name}
                  maxLength={120}
                  autoComplete="off"
                  placeholder={t("settings.apiTokenNamePlaceholder")}
                  disabled={creating}
                  aria-invalid={Boolean(nameError)}
                  aria-describedby={
                    nameError ? "api-token-name-error" : "api-token-name-help"
                  }
                  onChange={(event) => {
                    setName(event.target.value);
                    if (nameError) setNameError("");
                  }}
                />
                <FieldDescription id="api-token-name-help">
                  {t("settings.apiTokenNameHelp")}
                </FieldDescription>
                <FieldError id="api-token-name-error">{nameError}</FieldError>
              </Field>

              <Field>
                <FieldLabel htmlFor="api-token-expiration">
                  {t("settings.apiTokenExpiration")}
                </FieldLabel>
                <Select
                  value={String(expiresInDays)}
                  disabled={creating}
                  onValueChange={(value) => setExpiresInDays(Number(value))}
                >
                  <SelectTrigger id="api-token-expiration" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {EXPIRATION_OPTIONS.map((days) => (
                        <SelectItem key={days} value={String(days)}>
                          {t("settings.apiTokenExpirationDays", { days })}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <FieldSet aria-describedby="api-token-scopes-help api-token-scopes-error">
                <FieldLegend variant="label">{t("settings.apiTokenScopes")}</FieldLegend>
                <FieldDescription id="api-token-scopes-help">
                  {t("settings.apiTokenScopesHelp")}
                </FieldDescription>
                <div className="grid gap-2 sm:grid-cols-2">
                  {TOKEN_SCOPES.map((scope) => (
                    <Label
                      key={scope}
                      className="items-start gap-3 rounded-lg border p-3 font-normal has-data-checked:border-primary/30 has-data-checked:bg-primary/5"
                    >
                      <Checkbox
                        checked={scopes.includes(scope)}
                        disabled={creating}
                        onCheckedChange={(checked) =>
                          toggleScope(scope, checked === true)
                        }
                        aria-label={t(`settings.apiTokenScopeLabels.${scope}`)}
                        className="mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">
                          {t(`settings.apiTokenScopeLabels.${scope}`)}
                        </span>
                        <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                          {t(`settings.apiTokenScopeDescriptions.${scope}`)}
                        </span>
                      </span>
                    </Label>
                  ))}
                </div>
                <FieldError id="api-token-scopes-error">{scopesError}</FieldError>
              </FieldSet>
            </FieldGroup>
            <DialogFooter>
              <Button variant="outline" type="button" disabled={creating} onClick={resetAndClose}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={creating}>
                {creating
                  ? t("settings.creatingApiToken")
                  : t("settings.createApiToken")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TokenListSkeleton() {
  return (
    <div className="divide-y rounded-lg border" aria-hidden="true">
      {[0, 1].map((item) => (
        <div key={item} className="space-y-3 p-4">
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

function formatDate(value: string, language: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function tokenErrorMessage(
  error: unknown,
  t: (key: string, params?: Record<string, string | number>) => string,
  fallbackKey: string,
): string {
  const code = getThrownApiErrorCode(error);
  const key = code
    ? {
        UNAUTHENTICATED: "settings.apiTokenErrors.unauthenticated",
        INVALID_CSRF_TOKEN: "settings.apiTokenErrors.csrf",
        INVALID_API_TOKEN_NAME: "settings.apiTokenErrors.name",
        INVALID_API_TOKEN_SCOPES: "settings.apiTokenErrors.scopes",
        INVALID_API_TOKEN_EXPIRATION: "settings.apiTokenErrors.expiration",
        API_TOKEN_LIMIT_REACHED: "settings.apiTokenErrors.limit",
        API_TOKEN_NOT_FOUND: "settings.apiTokenErrors.notFound",
      }[code]
    : undefined;
  return t(key ?? fallbackKey);
}
