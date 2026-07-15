import { create } from "zustand";
import { getApi, getCsrfHeaders } from "../api/client";
import { ApiClientError, API_ERROR_MESSAGES, mapApiError } from "../api/errors";
import {
  acceptedInvitationView,
  invitationUrl,
  invitationView,
  memberRoleView,
  memberView,
  type AcceptedInvitation,
  type Invitation,
  type Member,
} from "./memberViews";

export type {
  AcceptedInvitation,
  Invitation,
  InvitationState,
  Member,
  MemberRole,
} from "./memberViews";

interface MembersState {
  members: Member[];
  membersOrganizationId: string | null;
  loading: boolean;
  error: string | null;
  invitations: Invitation[];
  invitationsOrganizationId: string | null;
  invitationsLoading: boolean;
  invitationsError: string | null;

  fetchMembers: (organizationId: string) => Promise<void>;
  fetchInvitations: (organizationId: string) => Promise<void>;
  clearInvitations: () => void;
  inviteMember: (
    organizationId: string,
    email: string,
    role: string,
  ) => Promise<{ inviteUrl: string }>;
  updateMemberRole: (
    organizationId: string,
    userId: string,
    role: string,
  ) => Promise<void>;
  removeMember: (organizationId: string, userId: string) => Promise<void>;
  revokeInvitation: (
    organizationId: string,
    invitationId: string,
  ) => Promise<void>;
  acceptInvitation: (token: string) => Promise<AcceptedInvitation>;
}

let membersRequestSequence = 0;
let invitationsRequestSequence = 0;

export const useMembersStore = create<MembersState>((set) => ({
  members: [],
  membersOrganizationId: null,
  loading: false,
  error: null,
  invitations: [],
  invitationsOrganizationId: null,
  invitationsLoading: false,
  invitationsError: null,

  fetchMembers: async (organizationId) => {
    const requestSequence = ++membersRequestSequence;
    set({
      members: [],
      membersOrganizationId: null,
      loading: true,
      error: null,
    });
    try {
      const result = await getApi().GET(
        "/_api/organizations/{organization_id}/members",
        { params: { path: { organization_id: organizationId } } },
      );
      if (result.error || !result.data) {
        throw mapApiError(result, {
          codes: { FORBIDDEN: API_ERROR_MESSAGES.FORBIDDEN },
          fallback: "Failed to fetch members",
        });
      }
      if (requestSequence !== membersRequestSequence) return;
      set({
        members: result.data.members.map(memberView),
        membersOrganizationId: organizationId,
        loading: false,
      });
    } catch (error) {
      if (requestSequence !== membersRequestSequence) return;
      console.error("Failed to fetch members", error);
      set({
        loading: false,
        error:
          error instanceof ApiClientError
            ? error.message
            : "Failed to fetch members",
      });
    }
  },

  fetchInvitations: async (organizationId) => {
    const requestSequence = ++invitationsRequestSequence;
    set({
      invitations: [],
      invitationsOrganizationId: null,
      invitationsLoading: true,
      invitationsError: null,
    });
    try {
      const result = await getApi().GET(
        "/_api/organizations/{organization_id}/invitations",
        { params: { path: { organization_id: organizationId } } },
      );
      if (result.error || !result.data) {
        throw mapApiError(result, {
          codes: { FORBIDDEN: API_ERROR_MESSAGES.FORBIDDEN },
          fallback: "Failed to fetch invitations",
        });
      }
      if (requestSequence !== invitationsRequestSequence) return;
      set({
        invitations: result.data.invitations.map(invitationView),
        invitationsOrganizationId: organizationId,
        invitationsLoading: false,
      });
    } catch (error) {
      if (requestSequence !== invitationsRequestSequence) return;
      set({
        invitationsLoading: false,
        invitationsError:
          error instanceof ApiClientError
            ? error.message
            : "Failed to fetch invitations",
      });
    }
  },

  clearInvitations: () => {
    invitationsRequestSequence += 1;
    set({
      invitations: [],
      invitationsOrganizationId: null,
      invitationsLoading: false,
      invitationsError: null,
    });
  },

  inviteMember: async (organizationId, email, role) => {
    const result = await getApi().POST(
      "/_api/organizations/{organization_id}/invitations",
      {
        params: {
          path: { organization_id: organizationId },
          header: getCsrfHeaders(),
        },
        body: { email, role: memberRoleView(role) },
      },
    );
    if (result.error || !result.data) {
      throw mapApiError(result, {
        codes: {
          ALREADY_MEMBER: API_ERROR_MESSAGES.ALREADY_MEMBER,
          INVITATION_PENDING: API_ERROR_MESSAGES.INVITATION_PENDING,
          FORBIDDEN: API_ERROR_MESSAGES.FORBIDDEN,
          INVALID_CSRF_TOKEN: API_ERROR_MESSAGES.INVALID_CSRF_TOKEN,
        },
        fallback: "Failed to create invitation",
      });
    }
    const invitation = invitationView(result.data.invitation);
    set((state) =>
      state.invitationsOrganizationId === organizationId
        ? {
            invitations: [
              invitation,
              ...state.invitations.filter((item) => item.id !== invitation.id),
            ],
          }
        : {},
    );
    return {
      inviteUrl: invitationUrl(result.data.acceptToken, window.location.origin),
    };
  },

  updateMemberRole: async (organizationId, userId, role) => {
    const result = await getApi().PATCH(
      "/_api/organizations/{organization_id}/members/{user_id}",
      {
        params: {
          path: { organization_id: organizationId, user_id: userId },
          header: getCsrfHeaders(),
        },
        body: { role: memberRoleView(role) },
      },
    );
    if (result.error) {
      throw mapApiError(result, {
        codes: {
          LAST_OWNER: API_ERROR_MESSAGES.LAST_OWNER,
          FORBIDDEN: API_ERROR_MESSAGES.FORBIDDEN,
          MEMBER_NOT_FOUND: API_ERROR_MESSAGES.NOT_FOUND,
        },
        fallback: "Failed to update role",
      });
    }
    if (result.data) {
      const updated = memberView(result.data.member);
      set((state) => ({
        members: state.members.map((member) =>
          member.userId === userId ? updated : member,
        ),
      }));
    }
  },

  removeMember: async (organizationId, userId) => {
    const result = await getApi().DELETE(
      "/_api/organizations/{organization_id}/members/{user_id}",
      {
        params: {
          path: { organization_id: organizationId, user_id: userId },
          header: getCsrfHeaders(),
        },
      },
    );
    if (result.error) {
      throw mapApiError(result, {
        codes: {
          LAST_OWNER: API_ERROR_MESSAGES.LAST_OWNER,
          FORBIDDEN: API_ERROR_MESSAGES.FORBIDDEN,
          MEMBER_NOT_FOUND: API_ERROR_MESSAGES.NOT_FOUND,
        },
        fallback: "Failed to remove member",
      });
    }
    set((state) => ({
      members: state.members.filter((member) => member.userId !== userId),
    }));
  },

  revokeInvitation: async (organizationId, invitationId) => {
    const result = await getApi().DELETE(
      "/_api/organizations/{organization_id}/invitations/{invitation_id}",
      {
        params: {
          path: {
            organization_id: organizationId,
            invitation_id: invitationId,
          },
          header: getCsrfHeaders(),
        },
      },
    );
    if (result.error) {
      throw mapApiError(result, {
        codes: {
          FORBIDDEN: API_ERROR_MESSAGES.FORBIDDEN,
          INVITATION_NOT_FOUND: API_ERROR_MESSAGES.INVITATION_NOT_FOUND,
          INVITATION_EXPIRED: API_ERROR_MESSAGES.INVITATION_EXPIRED,
          INVALID_CSRF_TOKEN: API_ERROR_MESSAGES.INVALID_CSRF_TOKEN,
        },
        fallback: "Failed to revoke invitation",
      });
    }
    set((state) => ({
      invitations: state.invitations.filter(
        (invitation) => invitation.id !== invitationId,
      ),
    }));
  },

  acceptInvitation: async (token) => {
    const result = await getApi().POST("/_api/invitations/accept", {
      params: { header: getCsrfHeaders() },
      body: { token },
    });
    if (result.error || !result.data) {
      throw mapApiError(result, {
        codes: {
          UNAUTHENTICATED: API_ERROR_MESSAGES.UNAUTHENTICATED,
          INVALID_CSRF_TOKEN: API_ERROR_MESSAGES.INVALID_CSRF_TOKEN,
          INVITATION_NOT_FOUND: API_ERROR_MESSAGES.INVITATION_NOT_FOUND,
          INVITATION_EXPIRED: API_ERROR_MESSAGES.INVITATION_EXPIRED,
          INVITATION_WRONG_RECIPIENT:
            API_ERROR_MESSAGES.INVITATION_WRONG_RECIPIENT,
          ALREADY_MEMBER: API_ERROR_MESSAGES.ALREADY_MEMBER,
          INVITATIONS_INFRASTRUCTURE_FAILURE:
            API_ERROR_MESSAGES.INVITATIONS_INFRASTRUCTURE_FAILURE,
        },
        fallback: "Failed to accept invitation",
      });
    }
    return acceptedInvitationView(result.data);
  },
}));
