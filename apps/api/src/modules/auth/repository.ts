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

export function createInMemoryAuthRepository(): AuthRepository {
  const users = new Map<string, UserRecord>();
  const organizations = new Map<string, OrganizationRecord>();
  const members = new Map<string, MemberRecord>();

  return {
    async emailExists(email) {
      return users.has(email);
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
  };
}
