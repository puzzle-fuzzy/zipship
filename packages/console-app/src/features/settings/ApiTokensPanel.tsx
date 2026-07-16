import { KeyRound, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/primitives/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "../../components/primitives/alert";
import { Button } from "../../components/primitives/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../../components/primitives/empty";
import { useTranslation } from "../../i18n";
import { listApiTokens, revokeApiToken, type ApiToken } from "./apiTokens";
import { CreateApiTokenDialog } from "./CreateApiTokenDialog";
import { TokenListSkeleton, TokenRow } from "./ApiTokenList";
import { tokenErrorMessage } from "./apiTokenPresentation";

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
    <section aria-labelledby="api-tokens-heading" className="flex min-w-0 flex-col gap-5">
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
          <AlertDescription className="flex flex-col gap-3">
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
