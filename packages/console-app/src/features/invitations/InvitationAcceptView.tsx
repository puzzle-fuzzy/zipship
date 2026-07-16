import {
  AlertCircle,
  CheckCircle2,
  LoaderCircle,
  LogIn,
  UserRoundCheck,
} from 'lucide-react';
import { Link } from 'react-router';
import { Alert, AlertDescription, AlertTitle } from '../../components/primitives/alert';
import { Button, buttonVariants } from '../../components/primitives/button';
import { AuthShell } from '../auth/AuthShell';
import { useTranslation } from '../../i18n';
import { cn } from '../../lib/utils';
import type { AcceptedInvitation } from '../../stores/membersStore';

export type InvitationProblem =
  | 'invalid'
  | 'wrong-recipient'
  | 'already-member'
  | 'temporary';

interface InvitationAcceptViewProps {
  accepted: AcceptedInvitation | null;
  authStatus: 'loading' | 'login' | 'authenticated';
  hasToken: boolean;
  problem: InvitationProblem | null;
  submitting: boolean;
  switchingAccount: boolean;
  onAccept: () => void;
  onSwitchAccount: () => void;
}

export function InvitationAcceptView({
  accepted,
  authStatus,
  hasToken,
  problem,
  submitting,
  switchingAccount,
  onAccept,
  onSwitchAccount,
}: InvitationAcceptViewProps) {
  const { t } = useTranslation();

  if (!hasToken && !accepted && !problem) {
    return (
      <InvitationStateShell>
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>{t('invitationAccept.missingTitle')}</AlertTitle>
          <AlertDescription>{t('invitationAccept.missingDesc')}</AlertDescription>
        </Alert>
      </InvitationStateShell>
    );
  }

  if (accepted) {
    return (
      <InvitationStateShell>
        <Alert>
          <CheckCircle2 aria-hidden="true" />
          <AlertTitle>{t('invitationAccept.acceptedTitle')}</AlertTitle>
          <AlertDescription>
            {t('invitationAccept.acceptedDesc', {
              role: t(`members.${accepted.role}`),
            })}
          </AlertDescription>
        </Alert>
        <ConsoleLink />
      </InvitationStateShell>
    );
  }

  if (problem === 'invalid') {
    return (
      <InvitationStateShell>
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>{t('invitationAccept.invalidTitle')}</AlertTitle>
          <AlertDescription>{t('invitationAccept.invalidDesc')}</AlertDescription>
        </Alert>
      </InvitationStateShell>
    );
  }

  if (problem === 'already-member') {
    return (
      <InvitationStateShell>
        <Alert>
          <UserRoundCheck aria-hidden="true" />
          <AlertTitle>{t('invitationAccept.alreadyMemberTitle')}</AlertTitle>
          <AlertDescription>{t('invitationAccept.alreadyMemberDesc')}</AlertDescription>
        </Alert>
        <ConsoleLink />
      </InvitationStateShell>
    );
  }

  if (authStatus === 'loading') {
    return (
      <InvitationStateShell>
        <div
          className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"
          aria-live="polite"
        >
          <LoaderCircle className="animate-spin" aria-hidden="true" />
          {t('common.loading')}
        </div>
      </InvitationStateShell>
    );
  }

  if (authStatus === 'login') {
    return (
      <InvitationStateShell>
        <Alert>
          <LogIn aria-hidden="true" />
          <AlertTitle>{t('invitationAccept.signInTitle')}</AlertTitle>
          <AlertDescription>{t('invitationAccept.signInDesc')}</AlertDescription>
        </Alert>
        <Link
          className={cn(buttonVariants({ size: 'lg' }), 'mt-5 w-full')}
          to="/login"
        >
          {t('invitationAccept.continueToSignIn')}
        </Link>
      </InvitationStateShell>
    );
  }

  return (
    <InvitationStateShell>
      {problem === 'wrong-recipient' ? (
        <Alert variant="destructive" className="mb-5">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>{t('invitationAccept.wrongRecipientTitle')}</AlertTitle>
          <AlertDescription>{t('invitationAccept.wrongRecipientDesc')}</AlertDescription>
        </Alert>
      ) : null}
      {problem === 'temporary' ? (
        <Alert variant="destructive" className="mb-5">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>{t('invitationAccept.temporaryTitle')}</AlertTitle>
          <AlertDescription>{t('invitationAccept.temporaryDesc')}</AlertDescription>
        </Alert>
      ) : null}
      {!problem ? (
        <Alert className="mb-5">
          <UserRoundCheck aria-hidden="true" />
          <AlertTitle>{t('invitationAccept.readyTitle')}</AlertTitle>
          <AlertDescription>{t('invitationAccept.readyDesc')}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          className="flex-1"
          size="lg"
          onClick={onAccept}
          disabled={submitting || switchingAccount}
        >
          {submitting ? (
            <LoaderCircle
              data-icon="inline-start"
              className="animate-spin"
              aria-hidden="true"
            />
          ) : null}
          {submitting ? t('invitationAccept.accepting') : t('invitationAccept.accept')}
        </Button>
        {problem === 'wrong-recipient' ? (
          <Button
            variant="outline"
            size="lg"
            onClick={onSwitchAccount}
            disabled={switchingAccount || submitting}
          >
            {switchingAccount ? (
              <LoaderCircle
                data-icon="inline-start"
                className="animate-spin"
                aria-hidden="true"
              />
            ) : null}
            {t('invitationAccept.useAnotherAccount')}
          </Button>
        ) : null}
      </div>
    </InvitationStateShell>
  );
}

function ConsoleLink() {
  const { t } = useTranslation();
  return (
    <Link className={cn(buttonVariants({ size: 'lg' }), 'mt-5 w-full')} to="/app">
      {t('invitationAccept.openConsole')}
    </Link>
  );
}

function InvitationStateShell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <AuthShell
      title={t('invitationAccept.title')}
      description={t('invitationAccept.description')}
    >
      {children}
    </AuthShell>
  );
}
