import { Users, X } from 'lucide-react';
import { Avatar, AvatarFallback } from '../../components/ui/avatar';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '../../components/ui/empty';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '../../components/ui/item';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Skeleton } from '../../components/ui/skeleton';
import { useTranslation } from '../../i18n';
import type { Member } from '../../stores/membersStore';
import { formatMemberDate, MANAGEABLE_ROLES } from './memberPresentation';

interface ActiveMemberListProps {
  canManage: boolean;
  currentUserId: string | null;
  loading: boolean;
  members: Member[];
  onChangeRole: (member: Member, role: string) => void;
  onRemove: (member: Member) => void;
}

export function ActiveMemberList({
  canManage,
  currentUserId,
  loading,
  members,
  onChangeRole,
  onRemove,
}: ActiveMemberListProps) {
  const { t, language } = useTranslation();
  const ownerCount = members.filter((member) => member.role === 'owner').length;

  return (
    <section aria-labelledby="active-members-heading">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 id="active-members-heading" className="text-sm font-medium">
          {t('members.activeMembers')}
        </h3>
        <Badge variant="secondary">
          {t('members.memberCount', { count: members.length })}
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
            <EmptyTitle>{t('members.empty')}</EmptyTitle>
            <EmptyDescription>{t('members.emptyDesc')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ItemGroup className="gap-2">
          {members.map((member) => {
            const isSelf = member.userId === currentUserId;
            const isLastOwner = member.role === 'owner' && ownerCount === 1;
            const removeDisabled = !canManage || isSelf || isLastOwner;

            return (
              <Item key={member.id} variant="outline" className="items-start">
                <ItemMedia>
                  <Avatar>
                    <AvatarFallback>{member.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="max-w-full">
                    <span className="truncate">{member.name}</span>
                    {isSelf ? <Badge variant="ghost">{t('members.you')}</Badge> : null}
                  </ItemTitle>
                  <ItemDescription className="break-all">
                    {member.email}
                    {member.joinedAt ? (
                      <span className="block">
                        {t('members.joined', {
                          date: formatMemberDate(member.joinedAt, language),
                        })}
                      </span>
                    ) : null}
                  </ItemDescription>
                </ItemContent>
                <ItemActions className="w-full justify-end sm:w-auto">
                  {member.role === 'owner' ? (
                    <Badge variant="outline">{t('members.owner')}</Badge>
                  ) : (
                    <Select
                      value={member.role}
                      disabled={!canManage || isSelf}
                      onValueChange={(role) => onChangeRole(member, role)}
                    >
                      <SelectTrigger size="sm" className="w-32" aria-label={t('members.role')}>
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
                    aria-label={t('members.remove')}
                    onClick={() => onRemove(member)}
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

function MemberListSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      {[0, 1].map((item) => (
        <div key={item} className="flex items-center gap-3 rounded-lg border p-3">
          <Skeleton className="size-8 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48 max-w-full" />
          </div>
          <Skeleton className="h-7 w-28" />
        </div>
      ))}
    </div>
  );
}
