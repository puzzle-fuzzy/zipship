import type { MemberRole } from '@zipship/shared';

export type { MemberRole } from '@zipship/shared';

export interface Member {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: MemberRole;
  joinedAt: string;
}

export type AssignableMemberRole = Exclude<MemberRole, 'owner'>;
