import type { components } from '@zipship/api-client';

type MemberDto = components['schemas']['MemberResponse'];
type InvitationDto = components['schemas']['InvitationResponse'];
type AcceptedInvitationDto = components['schemas']['AcceptedInvitationResponse'];

export type MemberRole = components['schemas']['MemberRoleDto'];
export type InvitationState = components['schemas']['InvitationStateDto'];

export interface Member {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: MemberRole;
  joinedAt: string;
}

export interface Invitation {
  id: string;
  organizationId: string;
  email: string;
  role: MemberRole;
  state: InvitationState;
  invitedBy: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface AcceptedInvitation {
  invitationId: string;
  organizationId: string;
  userId: string;
  role: MemberRole;
  replayed: boolean;
}

export function memberView(member: MemberDto): Member {
  return {
    id: member.userId,
    userId: member.userId,
    name: member.displayName,
    email: member.email,
    role: memberRoleView(member.role),
    joinedAt: member.joinedAt,
  };
}

export function invitationView(invitation: InvitationDto): Invitation {
  return {
    id: invitation.id,
    organizationId: invitation.organizationId,
    email: invitation.email,
    role: memberRoleView(invitation.role),
    state: invitation.state,
    invitedBy: invitation.invitedBy ?? null,
    createdAt: invitation.createdAt,
    expiresAt: invitation.expiresAt,
  };
}

export function acceptedInvitationView(
  invitation: AcceptedInvitationDto,
): AcceptedInvitation {
  return {
    invitationId: invitation.invitationId,
    organizationId: invitation.organizationId,
    userId: invitation.userId,
    role: memberRoleView(invitation.role),
    replayed: invitation.replayed,
  };
}

export function memberRoleView(value: string): MemberRole {
  if (
    value === 'owner' ||
    value === 'admin' ||
    value === 'developer' ||
    value === 'deployer' ||
    value === 'viewer'
  ) {
    return value;
  }

  throw new Error(`Unsupported member role: ${value}`);
}

export function invitationUrl(token: string, origin: string): string {
  const url = new URL('/invitations/accept', origin);
  url.hash = `token=${encodeURIComponent(token)}`;
  return url.toString();
}
