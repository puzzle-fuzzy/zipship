import {
  CalendarClock,
  Mail,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "../../i18n";
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
import { Avatar, AvatarFallback } from "../../components/ui/avatar";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../../components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "../../components/ui/item";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Separator } from "../../components/ui/separator";
import { Skeleton } from "../../components/ui/skeleton";
import type { Invitation, Member } from "../../stores/membersStore";

const MANAGEABLE_ROLES = ["admin", "developer", "deployer", "viewer"] as const;

type PendingAction =
  | { kind: "remove-member"; member: Member }
  | { kind: "revoke-invitation"; invitation: Invitation };

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
  const { t, language } = useTranslation();
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [confirming, setConfirming] = useState(false);
  const ownerCount = members.filter((member) => member.role === "owner").length;

  const handleRoleChange = async (member: Member, role: string) => {
    try {
      await onChangeRole(member, role);
      toast.success(t("members.roleChanged"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("members.roleChanged"),
      );
    }
  };

  const handleConfirm = async (event: React.MouseEvent) => {
    event.preventDefault();
    if (!pendingAction || confirming) return;
    setConfirming(true);
    try {
      if (pendingAction.kind === "remove-member") {
        await onRemove(pendingAction.member);
        toast.success(t("members.memberRemoved"));
      } else {
        await onRevokeInvitation(pendingAction.invitation);
        toast.success(t("members.invitationRevoked"));
      }
      setPendingAction(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("common.retry"),
      );
    } finally {
      setConfirming(false);
    }
  };

  const confirmationTitle = pendingAction
    ? pendingAction.kind === "remove-member"
      ? t("members.removeConfirm", { name: pendingAction.member.name })
      : t("members.revokeConfirm", { email: pendingAction.invitation.email })
    : "";
  const confirmationDescription =
    pendingAction?.kind === "remove-member"
      ? t("members.removeConfirmDesc")
      : t("members.revokeConfirmDesc");

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>{t("members.title")}</CardTitle>
              <CardDescription>{t("members.description")}</CardDescription>
            </div>
            {canManage && (
              <Button size="sm" onClick={onInviteClick}>
                <UserPlus data-icon="inline-start" />
                {t("members.invite")}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <section aria-labelledby="active-members-heading">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 id="active-members-heading" className="text-sm font-medium">
                {t("members.activeMembers")}
              </h3>
              <Badge variant="secondary">
                {t("members.memberCount", { count: members.length })}
              </Badge>
            </div>

            {loading ? (
              <MemberListSkeleton />
            ) : members.length === 0 ? (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Users aria-hidden="true" />
                  </EmptyMedia>
                  <EmptyTitle>{t("members.empty")}</EmptyTitle>
                  <EmptyDescription>{t("members.emptyDesc")}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ItemGroup className="gap-2">
                {members.map((member) => {
                  const isSelf = member.userId === currentUserId;
                  const isLastOwner = member.role === "owner" && ownerCount === 1;
                  const removeDisabled = !canManage || isSelf || isLastOwner;

                  return (
                    <Item key={member.id} variant="outline" className="items-start">
                      <ItemMedia>
                        <Avatar>
                          <AvatarFallback>
                            {member.name.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      </ItemMedia>
                      <ItemContent className="min-w-0">
                        <ItemTitle className="max-w-full">
                          <span className="truncate">{member.name}</span>
                          {isSelf && (
                            <Badge variant="ghost">{t("members.you")}</Badge>
                          )}
                        </ItemTitle>
                        <ItemDescription className="break-all">
                          {member.email}
                          {member.joinedAt && (
                            <span className="block">
                              {t("members.joined", {
                                date: formatDate(member.joinedAt, language),
                              })}
                            </span>
                          )}
                        </ItemDescription>
                      </ItemContent>
                      <ItemActions className="w-full justify-end sm:w-auto">
                        {member.role === "owner" ? (
                          <Badge variant="outline">{t("members.owner")}</Badge>
                        ) : (
                          <Select
                            value={member.role}
                            disabled={!canManage || isSelf}
                            onValueChange={(role) =>
                              void handleRoleChange(member, role)
                            }
                          >
                            <SelectTrigger
                              size="sm"
                              className="w-32"
                              aria-label={t("members.role")}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {MANAGEABLE_ROLES.map((role) => (
                                  <SelectItem key={role} value={role}>
                                    {t(`members.${role}`)}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground hover:text-destructive"
                          disabled={removeDisabled}
                          aria-label={t("members.remove")}
                          onClick={() =>
                            setPendingAction({ kind: "remove-member", member })
                          }
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

          {canManage && (
            <>
              <Separator />
              <section aria-labelledby="pending-invitations-heading">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <h3
                      id="pending-invitations-heading"
                      className="text-sm font-medium"
                    >
                      {t("members.pendingInvitations")}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t("members.pendingDescription")}
                    </p>
                  </div>
                  <Badge variant="secondary">
                    {t("members.pendingCount", { count: invitations.length })}
                  </Badge>
                </div>

                {invitationsError ? (
                  <Alert variant="destructive">
                    <Mail aria-hidden="true" />
                    <AlertTitle>{t("members.invitationLoadFailed")}</AlertTitle>
                    <AlertDescription className="flex flex-col items-start gap-3">
                      <span>{invitationsError}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={onRetryInvitations}
                      >
                        {t("common.retry")}
                      </Button>
                    </AlertDescription>
                  </Alert>
                ) : invitationsLoading ? (
                  <InvitationListSkeleton />
                ) : invitations.length === 0 ? (
                  <Empty className="border">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <Mail aria-hidden="true" />
                      </EmptyMedia>
                      <EmptyTitle>{t("members.noPendingInvitations")}</EmptyTitle>
                      <EmptyDescription>
                        {t("members.noPendingInvitationsDesc")}
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  <ItemGroup className="gap-2">
                    {invitations.map((invitation) => {
                      const ownerRestricted =
                        invitation.role === "owner" && currentUserRole !== "owner";
                      return (
                        <Item
                          key={invitation.id}
                          variant="outline"
                          className="items-start"
                        >
                          <ItemMedia variant="icon">
                            <Mail aria-hidden="true" />
                          </ItemMedia>
                          <ItemContent className="min-w-0">
                            <ItemTitle className="max-w-full">
                              <span className="truncate">{invitation.email}</span>
                              <Badge variant="outline">
                                {t(`members.${invitation.role}`)}
                              </Badge>
                            </ItemTitle>
                            <ItemDescription className="flex items-center gap-1.5">
                              <CalendarClock aria-hidden="true" className="size-3.5" />
                              {t("members.expires", {
                                date: formatDate(invitation.expiresAt, language),
                              })}
                            </ItemDescription>
                          </ItemContent>
                          <ItemActions className="w-full justify-end sm:w-auto">
                            <Badge variant="secondary">
                              {t("members.pending")}
                            </Badge>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-muted-foreground hover:text-destructive"
                              disabled={ownerRestricted}
                              aria-label={t("members.revoke")}
                              title={
                                ownerRestricted
                                  ? t("members.ownerInvitationRestricted")
                                  : undefined
                              }
                              onClick={() =>
                                setPendingAction({
                                  kind: "revoke-invitation",
                                  invitation,
                                })
                              }
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
            </>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={Boolean(pendingAction)}
        onOpenChange={(open) => {
          if (!open && !confirming) setPendingAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmationTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmationDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirming}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={confirming}
              onClick={handleConfirm}
            >
              {confirming
                ? t("members.confirming")
                : t("members.confirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function MemberListSkeleton() {
  return (
    <div className="space-y-2" aria-hidden="true">
      {[0, 1].map((item) => (
        <div key={item} className="flex items-center gap-3 rounded-lg border p-3">
          <Skeleton className="size-8 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48 max-w-full" />
          </div>
          <Skeleton className="h-7 w-28" />
        </div>
      ))}
    </div>
  );
}

function InvitationListSkeleton() {
  return (
    <div className="space-y-2" aria-hidden="true">
      {[0, 1].map((item) => (
        <div key={item} className="flex items-center gap-3 rounded-lg border p-3">
          <Skeleton className="size-8" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-44 max-w-full" />
            <Skeleton className="h-3 w-36" />
          </div>
          <Skeleton className="h-7 w-20" />
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
