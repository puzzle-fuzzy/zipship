import { create } from 'zustand';
import { authHeaders, getApi } from '../api/client';
import { API_ERROR_MESSAGES, mapApiError } from '../api/errors';

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

  fetchMembers: (organizationId: string) => Promise<void>;
  inviteMember: (
    organizationId: string,
    email: string,
    role: string,
  ) => Promise<{ inviteUrl: string }>;
  updateMemberRole: (organizationId: string, userId: string, role: string) => Promise<void>;
  removeMember: (organizationId: string, userId: string) => Promise<void>;
}

export const useMembersStore = create<MembersState>((set) => ({
  members: [],
  loading: false,
  error: null,

  fetchMembers: async (organizationId: string) => {
    set({ loading: true, error: null });
    try {
      const api = getApi();
      const res = await api._api.organizations({ organizationId }).members.get({
        headers: authHeaders(),
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

  inviteMember: async (organizationId, email, role) => {
    const api = getApi();
    const res = await api._api.organizations({ organizationId }).invitations.post(
      { email, role: role as any },
      { headers: authHeaders() },
    );
    if (res.error) {
      throw mapApiError(res, {
        codes: {
          USER_NOT_FOUND: API_ERROR_MESSAGES.USER_NOT_FOUND,
          ALREADY_MEMBER: API_ERROR_MESSAGES.ALREADY_MEMBER,
          INVITATION_PENDING: API_ERROR_MESSAGES.INVITATION_PENDING,
          FORBIDDEN: API_ERROR_MESSAGES.FORBIDDEN,
        },
        fallback: 'Failed to send invitation',
      });
    }
    return res.data as { inviteUrl: string };
  },

  updateMemberRole: async (organizationId, userId, role) => {
    const api = getApi();
    const res = await api._api.organizations({ organizationId }).members({ userId }).patch(
      { role: role as 'admin' | 'developer' | 'deployer' | 'viewer' },
      { headers: authHeaders() },
    );
    if (res.error) {
      throw mapApiError(res, {
        codes: {
          LAST_OWNER: API_ERROR_MESSAGES.LAST_OWNER,
          FORBIDDEN: API_ERROR_MESSAGES.FORBIDDEN,
          NOT_FOUND: API_ERROR_MESSAGES.NOT_FOUND,
        },
        fallback: 'Failed to update role',
      });
    }
    set((state) => ({
      members: state.members.map((m) => (m.userId === userId ? { ...m, role } : m)),
    }));
  },

  removeMember: async (organizationId, userId) => {
    const api = getApi();
    const res = await api._api
      .organizations({ organizationId })
      .members({ userId })
      .delete({ headers: authHeaders() });
    if (res.error) {
      throw mapApiError(res, {
        codes: {
          LAST_OWNER: API_ERROR_MESSAGES.LAST_OWNER,
          FORBIDDEN: API_ERROR_MESSAGES.FORBIDDEN,
          NOT_FOUND: API_ERROR_MESSAGES.NOT_FOUND,
        },
        fallback: 'Failed to remove member',
      });
    }
    set((state) => ({
      members: state.members.filter((m) => m.userId !== userId),
    }));
  },
}));
