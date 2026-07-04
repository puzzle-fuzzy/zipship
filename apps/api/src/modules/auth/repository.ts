import type { AuthRepository } from "./service";

interface UserRecord {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
}

interface OrganizationRecord {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
}

interface MemberRecord {
  id: string;
  organizationId: string;
  userId: string;
  role: "owner";
  status: "active";
}

interface SessionRecord {
  id: string;
  userId: string;
  clientType: "web" | "desktop";
  refreshTokenHash: string;
  expiresAt: Date;
}

export function createInMemoryAuthRepository(): AuthRepository {
  const users = new Map<string, UserRecord>();
  const organizations = new Map<string, OrganizationRecord>();
  const members = new Map<string, MemberRecord>();
  const sessions = new Map<string, SessionRecord>();

  return {
    async emailExists(email) {
      return users.has(email);
    },

    async findUserByEmail(email) {
      return users.get(email) ?? null;
    },

    async createUserWithDefaultOrganization(input) {
      const user: UserRecord = {
        id: crypto.randomUUID(),
        ...input.user,
      };
      const organization: OrganizationRecord = {
        id: crypto.randomUUID(),
        ownerId: user.id,
        ...input.organization,
      };
      const member: MemberRecord = {
        id: crypto.randomUUID(),
        organizationId: organization.id,
        userId: user.id,
        ...input.member,
      };

      users.set(user.email, user);
      organizations.set(organization.id, organization);
      members.set(member.id, member);

      return {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
        },
        organization: {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
        },
        member: {
          id: member.id,
          role: member.role,
        },
      };
    },

    async createSession(input) {
      const session: SessionRecord = {
        id: crypto.randomUUID(),
        ...input,
      };

      sessions.set(session.id, session);

      return {
        id: session.id,
        clientType: session.clientType,
        expiresAt: session.expiresAt.toISOString(),
      };
    },

    async findSessionByRefreshTokenHash(refreshTokenHash, now) {
      const session = Array.from(sessions.values()).find(
        (candidate) => candidate.refreshTokenHash === refreshTokenHash && candidate.expiresAt > now,
      );

      if (!session) return null;

      const user = Array.from(users.values()).find((candidate) => candidate.id === session.userId);

      if (!user) return null;

      return {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
        },
        session: {
          id: session.id,
          clientType: session.clientType,
          expiresAt: session.expiresAt.toISOString(),
        },
      };
    },
  };
}
