import { UserPlus } from 'lucide-react';
import { useState, type MouseEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { Separator } from '../../components/ui/separator';
import { useTranslation } from '../../i18n';
import type { Invitation, Member } from '../../stores/membersStore';
import { ActiveMemberList } from './ActiveMemberList';
import { MemberActionDialog } from './MemberActionDialog';
import type { PendingMemberAction } from './memberPresentation';
import { PendingInvitationList } from './PendingInvitationList';

interface ProjectMembersTabProps {
  members: Member[];
  invitations: Invitation[];
  loading: boolean;
  invitationsLoading: boolean;
  invitationsError: string | null;
  canManage: boolean;
  currentUserId: string | null;
  currentUserRole: string | null;
  onInviteClick: () => void;
  onRetryInvitations: () => void;
  onChangeRole: (member: Member, role: string) => Promise<void>;
  onRemove: (member: Member) => Promise<void>;
  onRevokeInvitation: (invitation: Invitation) => Promise<void>;
}

export function ProjectMembersTab({
  members,
  invitations,
  loading,
  invitationsLoading,
  invitationsError,
  canManage,
  currentUserId,
  currentUserRole,
  onInviteClick,
  onRetryInvitations,
  onChangeRole,
  onRemove,
  onRevokeInvitation,
}: ProjectMembersTabProps) {
  const { t } = useTranslation();
  const [pendingAction, setPendingAction] = useState<PendingMemberAction | null>(null);
  const [confirming, setConfirming] = useState(false);

  const handleRoleChange = async (member: Member, role: string) => {
    try {
      await onChangeRole(member, role);
      toast.success(t('members.roleChanged'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('members.roleChanged'));
    }
  };

  const handleConfirm = async (event: MouseEvent) => {
    event.preventDefault();
    if (!pendingAction || confirming) return;

    setConfirming(true);
    try {
      if (pendingAction.kind === 'remove-member') {
        await onRemove(pendingAction.member);
        toast.success(t('members.memberRemoved'));
      } else {
        await onRevokeInvitation(pendingAction.invitation);
        toast.success(t('members.invitationRevoked'));
      }
      setPendingAction(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.retry'));
    } finally {
      setConfirming(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>{t('members.title')}</CardTitle>
              <CardDescription>{t('members.description')}</CardDescription>
            </div>
            {canManage ? (
              <Button size="sm" onClick={onInviteClick}>
                <UserPlus data-icon="inline-start" />
                {t('members.invite')}
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <ActiveMemberList
            canManage={canManage}
            currentUserId={currentUserId}
            loading={loading}
            members={members}
            onChangeRole={(member, role) => void handleRoleChange(member, role)}
            onRemove={(member) => setPendingAction({ kind: 'remove-member', member })}
          />

          {canManage ? (
            <>
              <Separator />
              <PendingInvitationList
                currentUserRole={currentUserRole}
                error={invitationsError}
                invitations={invitations}
                loading={invitationsLoading}
                onRetry={onRetryInvitations}
                onRevoke={(invitation) =>
                  setPendingAction({ kind: 'revoke-invitation', invitation })
                }
              />
            </>
          ) : null}
        </CardContent>
      </Card>

      <MemberActionDialog
        action={pendingAction}
        confirming={confirming}
        onConfirm={(event) => void handleConfirm(event)}
        onDismiss={() => setPendingAction(null)}
      />
    </>
  );
}
