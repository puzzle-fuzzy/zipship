import { describe, expect, test } from "bun:test";
import { AuthServiceError, DuplicateEmailError, InvalidRegistrationInputError } from "../../apps/api/src/modules/auth/model";
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
      async invalidateSession(_refreshTokenHash: string, _now: Date) {
        // registration flow does not exercise logout
      },
      async updateUser(_userId: string, _input: { name?: string }) {
        // registration flow does not exercise profile updates
      },
      async setUserPassword() {},
      async createPasswordResetToken() {},
      async findPasswordResetByTokenHash() {
        return null;
      },
      async markPasswordResetUsed() {},
    },
    auditRepository: {
      async createAuditLog() {
        return null as any;
      },
      async listAuditLogsForOrganization() {
        return [];
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

  test("rejects empty name as invalid input", async () => {
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

    const result = await auth.register({
      name: "",
      email: "ada@example.com",
      password: "correct-horse-battery",
    });

    expect(result).toBeInstanceOf(InvalidRegistrationInputError);
  });

  test("rejects whitespace-only name as invalid input", async () => {
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

    const result = await auth.register({
      name: "   ",
      email: "ada@example.com",
      password: "correct-horse-battery",
    });

    expect(result).toBeInstanceOf(InvalidRegistrationInputError);
  });

  test("rejects invalid email format", async () => {
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

    const result = await auth.register({
      name: "Ada",
      email: "not-an-email",
      password: "correct-horse-battery",
    });

    expect(result).toBeInstanceOf(InvalidRegistrationInputError);
  });

  test("rejects short password as invalid input", async () => {
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

    const result = await auth.register({
      name: "Ada",
      email: "ada@example.com",
      password: "1234567",
    });

    expect(result).toBeInstanceOf(InvalidRegistrationInputError);
  });

  test("creates session with explicit desktop clientType", async () => {
    const { authRepository, auditRepository } = createTestRepositories();
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
      name: "Desktop User",
      email: "desktop@example.com",
      password: "correct-horse-battery",
      clientType: "desktop",
    });

    expect(result).not.toBeInstanceOf(AuthServiceError);
    if (result instanceof AuthServiceError) return;
    expect(result.session.clientType).toBe("desktop");
  });

  test("defaults clientType to web when not provided", async () => {
    const { authRepository, auditRepository } = createTestRepositories();
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
      name: "Default User",
      email: "default@example.com",
      password: "correct-horse-battery",
    });

    expect(result).not.toBeInstanceOf(AuthServiceError);
    if (result instanceof AuthServiceError) return;
    expect(result.session.clientType).toBe("web");
  });

  test("falls back to a generated slug when email username is entirely special characters", async () => {
    const { authRepository, auditRepository } = createTestRepositories();
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
      name: "Dash User",
      email: "-@example.com",
      password: "correct-horse-battery",
    });

    expect(result).not.toBeInstanceOf(AuthServiceError);
    if (result instanceof AuthServiceError) return;
    // Should have a non-empty, non-"dash" fallback slug
    expect(result.organization.slug).not.toBe("");
    expect(result.organization.slug).not.toBe("-");
    expect(result.organization.slug).toMatch(/^user-/);
  });
});
