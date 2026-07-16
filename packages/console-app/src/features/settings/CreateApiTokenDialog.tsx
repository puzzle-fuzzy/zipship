import { Check, Copy, ShieldCheck } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "../../components/primitives/alert";
import { Button } from "../../components/primitives/button";
import { Checkbox } from "../../components/primitives/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "../../components/primitives/field";
import { Input } from "../../components/primitives/input";
import { Label } from "../../components/primitives/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { useTranslation } from "../../i18n";
import {
  createApiToken,
  type ApiToken,
  type ApiTokenScope,
} from "./apiTokens";
import { tokenErrorMessage } from "./apiTokenPresentation";

const TOKEN_SCOPES: ApiTokenScope[] = [
  "projects:read",
  "releases:read",
  "uploads:write",
  "deployments:write",
];

const EXPIRATION_OPTIONS = [7, 30, 90, 365] as const;

export function CreateApiTokenDialog({
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
            <div className="flex flex-col gap-4 py-4">
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
