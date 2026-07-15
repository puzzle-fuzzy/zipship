import type { components } from "@zipship/api-client";
import { create } from "zustand";
import { getApi, getCsrfHeaders } from "../api/client";
import { ApiClientError, API_ERROR_MESSAGES, mapApiError } from "../api/errors";

type MemberRole = components["schemas"]["MemberRoleDto"];
type MemberDto = components["schemas"]["MemberResponse"];

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
  updateMemberRole: (
    organizationId: string,
    userId: string,
    role: string,
  ) => Promise<void>;
  removeMember: (organizationId: string, userId: string) => Promise<void>;
}

function memberView(member: MemberDto): Member {
  return {
    id: member.userId,
    userId: member.userId,
    name: member.displayName,
    email: member.email,
    role: member.role,
    joinedAt: member.joinedAt,
  };
}

function invitationUrl(token: string): string {
  const url = new URL("/invitations/accept", window.location.origin);
  url.hash = `token=${encodeURIComponent(token)}`;
  return url.toString();
}

export const useMembersStore = create<MembersState>((set) => ({
  members: [],
  loading: false,
  error: null,

  fetchMembers: async (organizationId) => {
    set({ loading: true, error: null });
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
      set({
        members: result.data.members.map(memberView),
        loading: false,
      });
    } catch (error) {
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

  inviteMember: async (organizationId, email, role) => {
    const result = await getApi().POST(
      "/_api/organizations/{organization_id}/invitations",
      {
        params: {
          path: { organization_id: organizationId },
          header: getCsrfHeaders(),
        },
        body: { email, role: role as MemberRole },
      },
    );
    if (result.error || !result.data) {
      throw mapApiError(result, {
        codes: {
          ALREADY_MEMBER: API_ERROR_MESSAGES.ALREADY_MEMBER,
          INVITATION_ALREADY_PENDING:
            API_ERROR_MESSAGES.INVITATION_ALREADY_PENDING,
          FORBIDDEN: API_ERROR_MESSAGES.FORBIDDEN,
        },
        fallback: "Failed to create invitation",
      });
    }
    return { inviteUrl: invitationUrl(result.data.acceptToken) };
  },

  updateMemberRole: async (organizationId, userId, role) => {
    const result = await getApi().PATCH(
      "/_api/organizations/{organization_id}/members/{user_id}",
      {
        params: {
          path: { organization_id: organizationId, user_id: userId },
          header: getCsrfHeaders(),
        },
        body: { role: role as MemberRole },
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
}));
