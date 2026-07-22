import { useEffect, useState } from 'react';
import { ApiClientError } from '../api/errors';
import {
  clearAuthContinuation,
  setInvitationAuthContinuation,
} from '../features/auth/authContinuation';
import {
  InvitationAcceptView,
  type InvitationProblem,
} from '../features/invitations/InvitationAcceptView';
import {
  clearInvitationToken,
  useInvitationToken,
} from '../features/invitations/invitationToken';
import { useAuthStore, useMembersStore, useOrganizationsStore } from '../stores';
import type { AcceptedInvitation } from '../stores/membersStore';

export function InvitationAcceptPage() {
  const token = useInvitationToken();
  const status = useAuthStore((state) => state.status);
  const logout = useAuthStore((state) => state.logout);
  const initSession = useAuthStore((state) => state.initSession);
  const acceptInvitation = useMembersStore((state) => state.acceptInvitation);
  const preferOrganization = useOrganizationsStore((state) => state.preferOrganization);
  const [accepted, setAccepted] = useState<AcceptedInvitation | null>(null);
  const [problem, setProblem] = useState<InvitationProblem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);

  useEffect(() => {
    if (!token) {
      clearAuthContinuation();
      return;
    }
    if (status === 'login') setInvitationAuthContinuation();
  }, [status, token]);

  const handleAccept = async () => {
    if (!token || submitting) return;

    setSubmitting(true);
    setProblem(null);
    try {
      const result = await acceptInvitation(token);
      preferOrganization(result.organizationId);
      clearInvitationToken();
      clearAuthContinuation();
      setAccepted(result);
    } catch (error) {
      const code = error instanceof ApiClientError ? error.code : undefined;
      if (code === 'UNAUTHENTICATED') {
        setInvitationAuthContinuation();
        await initSession();
      } else if (code === 'INVITATION_NOT_FOUND' || code === 'INVITATION_EXPIRED') {
        clearInvitationToken();
        clearAuthContinuation();
        setProblem('invalid');
      } else if (code === 'INVITATION_WRONG_RECIPIENT') {
        setProblem('wrong-recipient');
      } else if (code === 'ALREADY_MEMBER') {
        clearInvitationToken();
        clearAuthContinuation();
        setProblem('already-member');
      } else {
        setProblem('temporary');
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
      setProblem('temporary');
    } finally {
      setSwitchingAccount(false);
    }
  };

  return (
    <InvitationAcceptView
      accepted={accepted}
      authStatus={status}
      hasToken={Boolean(token)}
      problem={problem}
      submitting={submitting}
      switchingAccount={switchingAccount}
      onAccept={() => void handleAccept()}
      onSwitchAccount={() => void handleSwitchAccount()}
    />
  );
}
