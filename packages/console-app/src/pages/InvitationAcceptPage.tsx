import {
  AlertCircle,
  CheckCircle2,
  LoaderCircle,
  LogIn,
  UserRoundCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Button, buttonVariants } from "../components/ui/button";
import {
  clearAuthContinuation,
  setInvitationAuthContinuation,
} from "../features/auth/authContinuation";
import { AuthShell } from "../features/auth/AuthShell";
import {
  clearInvitationToken,
  useInvitationToken,
} from "../features/invitations/invitationToken";
import { useTranslation } from "../i18n";
import { cn } from "../lib/utils";
import { ApiClientError } from "../api/errors";
import type { AcceptedInvitation } from "../stores/membersStore";
import { useAuthStore, useMembersStore } from "../stores";

type InvitationProblem =
  | "invalid"
  | "wrong-recipient"
  | "already-member"
  | "temporary";

export function InvitationAcceptPage() {
  const { t } = useTranslation();
  const token = useInvitationToken();
  const status = useAuthStore((state) => state.status);
  const logout = useAuthStore((state) => state.logout);
  const initSession = useAuthStore((state) => state.initSession);
  const acceptInvitation = useMembersStore((state) => state.acceptInvitation);
  const [accepted, setAccepted] = useState<AcceptedInvitation | null>(null);
  const [problem, setProblem] = useState<InvitationProblem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);

  useEffect(() => {
    if (!token) {
      clearAuthContinuation();
      return;
    }
    if (status === "login") setInvitationAuthContinuation();
  }, [status, token]);

  const handleAccept = async () => {
    if (!token || submitting) return;
    setSubmitting(true);
    setProblem(null);
    try {
      const result = await acceptInvitation(token);
      clearInvitationToken();
      clearAuthContinuation();
      setAccepted(result);
    } catch (error) {
      const code = error instanceof ApiClientError ? error.code : undefined;
      if (code === "UNAUTHENTICATED") {
        setInvitationAuthContinuation();
        await initSession();
      } else if (
        code === "INVITATION_NOT_FOUND" ||
        code === "INVITATION_EXPIRED"
      ) {
        clearInvitationToken();
        clearAuthContinuation();
        setProblem("invalid");
      } else if (code === "INVITATION_WRONG_RECIPIENT") {
        setProblem("wrong-recipient");
      } else if (code === "ALREADY_MEMBER") {
        clearInvitationToken();
        clearAuthContinuation();
        setProblem("already-member");
      } else {
        setProblem("temporary");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSwitchAccount = async () => {
    if (!token || switchingAccount) return;
    setSwitchingAccount(true);
    setInvitationAuthContinuation();
    try {
      await logout();
      setProblem(null);
    } catch {
      setProblem("temporary");
    } finally {
      setSwitchingAccount(false);
    }
  };

  if (!token && !accepted && !problem) {
    return (
      <InvitationStateShell>
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>{t("invitationAccept.missingTitle")}</AlertTitle>
          <AlertDescription>
            {t("invitationAccept.missingDesc")}
          </AlertDescription>
        </Alert>
      </InvitationStateShell>
    );
  }

  if (accepted) {
    return (
      <InvitationStateShell>
        <Alert>
          <CheckCircle2 aria-hidden="true" />
          <AlertTitle>{t("invitationAccept.acceptedTitle")}</AlertTitle>
          <AlertDescription>
            {t("invitationAccept.acceptedDesc", {
              role: t(`members.${accepted.role}`),
            })}
          </AlertDescription>
        </Alert>
        <Link
          className={cn(buttonVariants({ size: "lg" }), "mt-5 w-full")}
          to="/app"
        >
          {t("invitationAccept.openConsole")}
        </Link>
      </InvitationStateShell>
    );
  }

  if (problem === "invalid") {
    return (
      <InvitationStateShell>
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>{t("invitationAccept.invalidTitle")}</AlertTitle>
          <AlertDescription>
            {t("invitationAccept.invalidDesc")}
          </AlertDescription>
        </Alert>
      </InvitationStateShell>
    );
  }

  if (problem === "already-member") {
    return (
      <InvitationStateShell>
        <Alert>
          <UserRoundCheck aria-hidden="true" />
          <AlertTitle>{t("invitationAccept.alreadyMemberTitle")}</AlertTitle>
          <AlertDescription>
            {t("invitationAccept.alreadyMemberDesc")}
          </AlertDescription>
        </Alert>
        <Link
          className={cn(buttonVariants({ size: "lg" }), "mt-5 w-full")}
          to="/app"
        >
          {t("invitationAccept.openConsole")}
        </Link>
      </InvitationStateShell>
    );
  }

  if (status === "loading") {
    return (
      <InvitationStateShell>
        <div
          className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"
          aria-live="polite"
        >
          <LoaderCircle className="animate-spin" aria-hidden="true" />
          {t("common.loading")}
        </div>
      </InvitationStateShell>
    );
  }

  if (status === "login") {
    return (
      <InvitationStateShell>
        <Alert>
          <LogIn aria-hidden="true" />
          <AlertTitle>{t("invitationAccept.signInTitle")}</AlertTitle>
          <AlertDescription>
            {t("invitationAccept.signInDesc")}
          </AlertDescription>
        </Alert>
        <Link
          className={cn(buttonVariants({ size: "lg" }), "mt-5 w-full")}
          to="/login"
          onClick={setInvitationAuthContinuation}
        >
          {t("invitationAccept.continueToSignIn")}
        </Link>
      </InvitationStateShell>
    );
  }

  return (
    <InvitationStateShell>
      {problem === "wrong-recipient" && (
        <Alert variant="destructive" className="mb-5">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>{t("invitationAccept.wrongRecipientTitle")}</AlertTitle>
          <AlertDescription>
            {t("invitationAccept.wrongRecipientDesc")}
          </AlertDescription>
        </Alert>
      )}
      {problem === "temporary" && (
        <Alert variant="destructive" className="mb-5">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>{t("invitationAccept.temporaryTitle")}</AlertTitle>
          <AlertDescription>
            {t("invitationAccept.temporaryDesc")}
          </AlertDescription>
        </Alert>
      )}
      {!problem && (
        <Alert className="mb-5">
          <UserRoundCheck aria-hidden="true" />
          <AlertTitle>{t("invitationAccept.readyTitle")}</AlertTitle>
          <AlertDescription>{t("invitationAccept.readyDesc")}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          className="flex-1"
          size="lg"
          onClick={handleAccept}
          disabled={submitting || switchingAccount}
        >
          {submitting && (
            <LoaderCircle
              data-icon="inline-start"
              className="animate-spin"
              aria-hidden="true"
            />
          )}
          {submitting
            ? t("invitationAccept.accepting")
            : t("invitationAccept.accept")}
        </Button>
        {problem === "wrong-recipient" && (
          <Button
            variant="outline"
            size="lg"
            onClick={handleSwitchAccount}
            disabled={switchingAccount || submitting}
          >
            {switchingAccount && (
              <LoaderCircle
                data-icon="inline-start"
                className="animate-spin"
                aria-hidden="true"
              />
            )}
            {t("invitationAccept.useAnotherAccount")}
          </Button>
        )}
      </div>
    </InvitationStateShell>
  );
}

function InvitationStateShell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <AuthShell
      title={t("invitationAccept.title")}
      description={t("invitationAccept.description")}
    >
      {children}
    </AuthShell>
  );
}
