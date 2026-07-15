import { describe, expect, it } from 'vitest';
import {
  acceptedInvitationView,
  invitationUrl,
  invitationView,
  memberRoleView,
  memberView,
} from '../src/stores/memberViews';

const member = {
  userId: 'u1',
  displayName: 'Ada',
  email: 'ada@example.com',
  role: 'owner',
  joinedAt: '2026-07-15T00:00:00Z',
} as const;

const invitation = {
  id: 'invite-1',
  organizationId: 'org-1',
  email: 'new@example.com',
  role: 'developer',
  state: 'pending',
  invitedBy: null,
  createdAt: '2026-07-15T00:00:00Z',
  expiresAt: '2026-07-22T00:00:00Z',
} as const;

describe('member API views', () => {
  it('maps member and invitation identities', () => {
    expect(memberView(member)).toMatchObject({
      id: 'u1',
      userId: 'u1',
      name: 'Ada',
      role: 'owner',
    });
    expect(invitationView(invitation)).toMatchObject({
      id: 'invite-1',
      role: 'developer',
      invitedBy: null,
    });
  });

  it('maps accepted invitation results without leaking the bearer token', () => {
    expect(
      acceptedInvitationView({
        invitationId: 'invite-1',
        organizationId: 'org-1',
        userId: 'u2',
        role: 'viewer',
        replayed: true,
      }),
    ).toEqual({
      invitationId: 'invite-1',
      organizationId: 'org-1',
      userId: 'u2',
      role: 'viewer',
      replayed: true,
    });
  });

  it('accepts only supported member roles', () => {
    expect(memberRoleView('deployer')).toBe('deployer');
    expect(() => memberRoleView('superadmin')).toThrow(
      'Unsupported member role: superadmin',
    );
  });

  it('places invitation credentials only in the URL fragment', () => {
    const url = new URL(invitationUrl('secret token&value', 'https://zipship.test'));

    expect(url.pathname).toBe('/invitations/accept');
    expect(url.search).toBe('');
    expect(url.hash).toBe('#token=secret%20token%26value');
  });
});
