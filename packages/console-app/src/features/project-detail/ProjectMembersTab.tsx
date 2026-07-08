import { UserPlus } from "lucide-react";
import { useTranslation } from "../../i18n";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import type { Member } from "../../stores/membersStore";

interface ProjectMembersTabProps {
  members: Member[];
  loading: boolean;
  onInviteClick: () => void;
}

export function ProjectMembersTab({ members, loading, onInviteClick }: ProjectMembersTabProps) {
  const { t } = useTranslation();

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
            {members.map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                    {member.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{member.name}</div>
                    <div className="text-xs text-muted-foreground">{member.email}</div>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs">
                  {t(`members.${member.role}`)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
