import { UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "../../i18n";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import type { Member } from "../../stores/membersStore";

/** Roles the change-role endpoint accepts (owner is excluded — it's a badge). */
const MANAGEABLE_ROLES = ["admin", "developer", "deployer", "viewer"] as const;

interface ProjectMembersTabProps {
  members: Member[];
  loading: boolean;
  canManage: boolean;
  currentUserId: string | null;
  onInviteClick: () => void;
  /** Persist a role change; resolves on success, rejects on failure. The tab toasts. */
  onChangeRole: (member: Member, role: string) => Promise<void>;
  /** Remove a member; resolves on success, rejects on failure. The tab confirms + toasts. */
  onRemove: (member: Member) => Promise<void>;
}

export function ProjectMembersTab({
  members,
  loading,
  canManage,
  currentUserId,
  onInviteClick,
  onChangeRole,
  onRemove,
}: ProjectMembersTabProps) {
  const { t } = useTranslation();
  const ownerCount = members.filter((m) => m.role === "owner").length;

  const handleRoleChange = async (member: Member, role: string) => {
    try {
      await onChangeRole(member, role);
      toast.success(t("members.roleChanged"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("members.roleChanged"));
    }
  };

  const handleRemove = async (member: Member) => {
    if (!confirm(t("members.removeConfirm", { name: member.name }))) return;
    try {
      await onRemove(member);
      toast.success(t("members.memberRemoved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("members.remove"));
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-center justify-between">
          <div>
            <CardTitle>{t("members.title")}</CardTitle>
            <CardDescription>{t("members.inviteDesc")}</CardDescription>
          </div>
          <Button size="sm" onClick={onInviteClick}>
            <UserPlus className="size-4" />
            {t("members.invite")}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            {t("common.loading")}
          </div>
        ) : members.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            {t("members.empty")}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {members.map((member) => {
              const isSelf = member.userId === currentUserId;
              const isLastOwner = member.role === "owner" && ownerCount === 1;
              const removeDisabled = !canManage || isSelf || isLastOwner;

              return (
                <div
                  key={member.id}
                  className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                      {member.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {member.name}
                        {isSelf && (
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                            ({t("members.you")})
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{member.email}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {member.role === "owner" ? (
                      <span className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs">
                        {t("members.owner")}
                      </span>
                    ) : (
                      <Select
                        value={member.role}
                        disabled={!canManage || isSelf}
                        onValueChange={(role) => handleRoleChange(member, role)}
                      >
                        <SelectTrigger size="sm" className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {MANAGEABLE_ROLES.map((r) => (
                              <SelectItem key={r} value={r}>
                                {t(`members.${r}`)}
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
                      onClick={() => handleRemove(member)}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
