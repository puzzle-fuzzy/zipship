import { describe, expect, test } from "bun:test";
import { AuthServiceError, DuplicateEmailError } from "../../apps/api/src/modules/auth/model";
import { AuthService } from "../../apps/api/src/modules/auth/service";

function createTestRepositories() {
  const emails = new Set<string>();
  const calls: unknown[] = [];
  let sessionCount = 0;

  return {
    calls,
    authRepository: {
      async emailExists(email: string) {
        return emails.has(email);
      },
      async findUserByEmail() {
        return null;
      },
      async createUserWithDefaultOrganization(input: {
        user: { name: string; email: string; passwordHash: string };
        organization: { name: string; slug: string };
        member: { role: "owner"; status: "active" };
      }) {
        emails.add(input.user.email);
        calls.push(input);

        return {
          user: { id: "user-1", name: input.user.name, email: input.user.email },
          organization: { id: "org-1", name: input.organization.name, slug: input.organization.slug },
          member: { id: "member-1", role: input.member.role },
        };
      },
      async createSession(input: {
        userId: string;
        clientType: "web" | "desktop";
        refreshTokenHash: string;
        expiresAt: Date;
      }) {
        sessionCount++;
        return {
          id: `session-${sessionCount}`,
          clientType: input.clientType,
          expiresAt: input.expiresAt.toISOString(),
        };
      },
      async findSessionByRefreshTokenHash() {
        return null;
      },
      async findDefaultOrganizationForUser() {
        return null;
      },
    },
    auditRepository: {
      async createAuditLog() {
        return null as any;
      },
    },
  };
}

describe("auth registration", () => {
  test("creates a user, default organization, owner member, and session", async () => {
    const { authRepository, auditRepository, calls } = createTestRepositories();
    const expiresAt = new Date("2026-07-12T00:00:00.000Z");
    const auth = new AuthService({
      authRepository,
      auditRepository,
      hashPassword: async (password) => `hashed:${password}`,
      verifyPassword: async () => false,
      createRefreshToken: () => "refresh-token",
      hashRefreshToken: async (token) => `hashed-refresh:${token}`,
      now: () => new Date("2026-07-05T00:00:00.000Z"),
    });

    const result = await auth.register({
      name: "Ada Lovelace",
      email: "  ADA@Example.COM ",
      password: "correct-horse-battery",
    });

    expect(result).not.toBeInstanceOf(AuthServiceError);
    if (result instanceof AuthServiceError) {
      throw new Error("Registration unexpectedly failed");
    }

    expect(result.user).toEqual({ id: "user-1", name: "Ada Lovelace", email: "ada@example.com" });
    expect(result.organization).toEqual({ id: "org-1", name: "Ada Lovelace", slug: "ada" });
    expect(result.member).toEqual({ id: "member-1", role: "owner" });
    expect(result.session).toBeDefined();
    expect(result.session.clientType).toBe("web");
    expect(result.session.refreshToken).toBe("refresh-token");
    expect(result.session.expiresAt).toBe(expiresAt.toISOString());
    expect(calls).toEqual([
      {
        user: {
          name: "Ada Lovelace",
          email: "ada@example.com",
          passwordHash: "hashed:correct-horse-battery",
        },
        organization: {
          name: "Ada Lovelace",
          slug: "ada",
        },
        member: {
          role: "owner",
          status: "active",
        },
      },
    ]);
  });

  test("rejects duplicate email addresses after normalization", async () => {
    const { authRepository, auditRepository } = createTestRepositories();
    const auth = new AuthService({
      authRepository,
      auditRepository,
      hashPassword: async (password) => `hashed:${password}`,
      verifyPassword: async () => false,
      createRefreshToken: () => "unused-refresh-token",
      hashRefreshToken: async (token) => `unused:${token}`,
      now: () => new Date("2026-07-05T00:00:00.000Z"),
    });

    await auth.register({
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: "correct-horse-battery",
    });

    const result = await auth.register({
        name: "Ada Again",
        email: " ADA@example.com ",
        password: "correct-horse-battery",
      });

    expect(result).toBeInstanceOf(DuplicateEmailError);
  });
});
