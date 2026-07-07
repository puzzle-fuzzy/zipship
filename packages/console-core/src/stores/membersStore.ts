import { createApiClient } from '@zipship/api-client';
import { create } from 'zustand';

export interface Member {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  joinedAt: string;
}

interface MembersState {
  members: Member[];
  loading: boolean;
  error: string | null;

  fetchMembers: (apiBaseUrl: string, refreshToken: string, organizationId: string) => Promise<void>;
  inviteMember: (apiBaseUrl: string, refreshToken: string, organizationId: string, email: string, role: string) => Promise<{ inviteUrl: string }>;
}

export const useMembersStore = create<MembersState>((set) => ({
  members: [],
  loading: false,
  error: null,

  fetchMembers: async (apiBaseUrl: string, refreshToken: string, organizationId: string) => {
    set({ loading: true, error: null });
    try {
      const api = createApiClient(apiBaseUrl);
      const res = await api._api.organizations({ organizationId }).members.get({
        headers: { authorization: `Bearer ${refreshToken}` },
      });
      if (res.error) {
        set({ loading: false, error: 'Failed to fetch members' });
        return;
      }
      if (res.data) {
        set({ members: res.data.members as Member[], loading: false });
      }
    } catch (err) {
      console.error('Failed to fetch members:', err);
      set({ loading: false, error: 'Failed to fetch members' });
    }
  },

  inviteMember: async (apiBaseUrl, refreshToken, organizationId, email, role) => {
    const api = createApiClient(apiBaseUrl);
    const res = await api._api.organizations({ organizationId }).invitations.post(
      { email, role: role as any },
      { headers: { authorization: `Bearer ${refreshToken}` } },
    );
    if (res.error) {
      const code = (res.error.value as { code?: string })?.code;
      const messages: Record<string, string> = {
        USER_NOT_FOUND: 'User not found with this email',
        ALREADY_MEMBER: 'This user is already a member',
        INVITATION_PENDING: 'An invitation is already pending for this email',
        FORBIDDEN: 'You do not have permission to invite members',
      };
      throw new Error(messages[code ?? ''] ?? 'Failed to send invitation');
    }
    return res.data as { inviteUrl: string };
  },
}));
