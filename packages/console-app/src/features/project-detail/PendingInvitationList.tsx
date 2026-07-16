import { CalendarClock, Mail, X } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '../../components/primitives/alert';
import { Badge } from '../../components/primitives/badge';
import { Button } from '../../components/primitives/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '../../components/primitives/empty';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '../../components/primitives/item';
import { Skeleton } from '../../components/primitives/skeleton';
import { useTranslation } from '../../i18n';
import type { Invitation } from '../../stores/membersStore';
import { formatMemberDate } from './memberPresentation';

interface PendingInvitationListProps {
  currentUserRole: string | null;
  error: string | null;
  invitations: Invitation[];
  loading: boolean;
  onRetry: () => void;
  onRevoke: (invitation: Invitation) => void;
}

export function PendingInvitationList({
  currentUserRole,
  error,
  invitations,
  loading,
  onRetry,
  onRevoke,
}: PendingInvitationListProps) {
  const { t, language } = useTranslation();

  return (
    <section aria-labelledby="pending-invitations-heading">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 id="pending-invitations-heading" className="text-sm font-medium">
            {t('members.pendingInvitations')}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('members.pendingDescription')}
          </p>
        </div>
        <Badge variant="secondary">
          {t('members.pendingCount', { count: invitations.length })}
        </Badge>
      </div>

      {error ? (
        <Alert variant="destructive">
          <Mail aria-hidden="true" />
          <AlertTitle>{t('members.invitationLoadFailed')}</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={onRetry}>
              {t('common.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : loading ? (
        <InvitationListSkeleton />
      ) : invitations.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Mail aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>{t('members.noPendingInvitations')}</EmptyTitle>
            <EmptyDescription>{t('members.noPendingInvitationsDesc')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ItemGroup className="gap-2">
          {invitations.map((invitation) => {
            const ownerRestricted =
              invitation.role === 'owner' && currentUserRole !== 'owner';

            return (
              <Item key={invitation.id} variant="outline" className="items-start">
                <ItemMedia variant="icon">
                  <Mail aria-hidden="true" />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="max-w-full">
                    <span className="truncate">{invitation.email}</span>
                    <Badge variant="outline">{t(`members.${invitation.role}`)}</Badge>
                  </ItemTitle>
                  <ItemDescription className="flex items-center gap-1.5">
                    <CalendarClock aria-hidden="true" className="size-3.5" />
                    {t('members.expires', {
                      date: formatMemberDate(invitation.expiresAt, language),
                    })}
                  </ItemDescription>
                </ItemContent>
                <ItemActions className="w-full justify-end sm:w-auto">
                  <Badge variant="secondary">{t('members.pending')}</Badge>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-destructive"
                    disabled={ownerRestricted}
                    aria-label={t('members.revoke')}
                    title={ownerRestricted ? t('members.ownerInvitationRestricted') : undefined}
                    onClick={() => onRevoke(invitation)}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </ItemActions>
              </Item>
            );
          })}
        </ItemGroup>
      )}
    </section>
  );
}

function InvitationListSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      {[0, 1].map((item) => (
        <div key={item} className="flex items-center gap-3 rounded-lg border p-3">
          <Skeleton className="size-8" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-44 max-w-full" />
            <Skeleton className="h-3 w-36" />
          </div>
          <Skeleton className="h-7 w-20" />
        </div>
      ))}
    </div>
  );
}
