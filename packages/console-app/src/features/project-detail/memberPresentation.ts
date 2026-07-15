import type { Invitation, Member } from '../../stores/membersStore';

export const MANAGEABLE_ROLES = ['admin', 'developer', 'deployer', 'viewer'] as const;

export type PendingMemberAction =
  | { kind: 'remove-member'; member: Member }
  | { kind: 'revoke-invitation'; invitation: Invitation };

export function formatMemberDate(value: string, language: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
