import { describe, expect, test } from "bun:test";
import type { AuditCreateInput } from "../../apps/api/src/modules/audit/model";
import { AuthServiceError, InvalidCredentialsError, UnauthorizedError } from "../../apps/api/src/modules/auth/model";
import { AuthService } from "../../apps/api/src/modules/auth/service";

function createTestRepositories() {
  const users = new Map<string, { id: string; name: string; email: string; passwordHash: string }>();
  const sessions: unknown[] = [];
  const auditLogs: unknown[] = [];

  return {
    sessions,
    auditLogs,
    authRepository: {
      addUser(user: { id: string; name: string; email: string; passwordHash: string }) {
        users.set(user.email, user);
      },
      async emailExists(email: string) {
        return users.has(email);
      },
      async findUserByEmail(email: string) {
        return users.get(email) ?? null;
      },
      async createUserWithDefaultOrganization() {
        throw new Error("createUserWithDefaultOrganization is not used by login tests");
      },
      async createSession(input: {
        userId: string;
        clientType: "web" | "desktop";
        refreshTokenHash: string;
        expiresAt: Date;
      }) {
        sessions.push(input);
        return {
          id: "session-1",
          clientType: input.clientType,
          expiresAt: input.expiresAt.toISOString(),
        };
      },
      async findSessionByRefreshTokenHash(refreshTokenHash: string, now: Date) {
        const session = sessions.find((candidate) => {
          const value = candidate as {
            userId: string;
            clientType: "web" | "desktop";
            refreshTokenHash: string;
            expiresAt: Date;
          };

          return value.refreshTokenHash === refreshTokenHash && value.expiresAt > now;
        }) as
          | {
              userId: string;
              clientType: "web" | "desktop";
              refreshTokenHash: string;
              expiresAt: Date;
            }
          | undefined;

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
            id: "session-1",
            clientType: session.clientType,
            expiresAt: session.expiresAt.toISOString(),
          },
        };
      },
      async findDefaultOrganizationForUser(userId: string) {
        return {
          id: "org-1",
          userId,
        };
      },
      async invalidateSession(_refreshTokenHash: string, _now: Date) {
        // login flow does not exercise logout
      },
      async updateUser(_userId: string, _input: { name?: string }) {
        // login flow does not exercise profile updates
      },
      async setUserPassword() {},
      async createPasswordResetToken() {},
      async findPasswordResetByTokenHash() {
        return null;
      },
      async markPasswordResetUsed() {},
    },
    auditRepository: {
      async createAuditLog(input: AuditCreateInput) {
        auditLogs.push(input);
        return {
          id: "audit-1",
          ...input,
          createdAt: input.createdAt.toISOString(),
        };
      },
      async listAuditLogsForOrganization() {
        return [];
      },
    },
  };
}

describe("auth login", () => {
  test("returns a session and refresh token for valid credentials", async () => {
    const { authRepository, auditRepository, sessions, auditLogs } = createTestRepositories();
    (authRepository as any).addUser({
      id: "user-1",
      name: "Ada Lovelace",
      email: "ada@example.com",
      passwordHash: "stored-password-hash",
    });
    const expiresAt = new Date("2026-07-12T00:00:00.000Z");
    const auth = new AuthService({
      authRepository,
      auditRepository,
      hashPassword: async (password) => `hashed:${password}`,
      verifyPassword: async (password, hash) => password === "correct-horse-battery" && hash === "stored-password-hash",
      createRefreshToken: () => "refresh-token",
      hashRefreshToken: async (token) => `hashed-refresh:${token}`,
      now: () => new Date("2026-07-05T00:00:00.000Z"),
    });

    const result = await auth.login({
      email: " ADA@example.com ",
      password: "correct-horse-battery",
      clientType: "desktop",
    });

    expect(result).not.toBeInstanceOf(AuthServiceError);
    if (result instanceof AuthServiceError) {
      throw new Error("Login unexpectedly failed");
    }

    expect(result).toEqual({
      user: {
        id: "user-1",
        name: "Ada Lovelace",
        email: "ada@example.com",
      },
      session: {
        id: "session-1",
        clientType: "desktop",
        refreshToken: "refresh-token",
        expiresAt: expiresAt.toISOString(),
      },
    });
    expect(sessions).toEqual([
      {
        userId: "user-1",
        clientType: "desktop",
        refreshTokenHash: "hashed-refresh:refresh-token",
        expiresAt,
      },
    ]);
    expect(auditLogs).toEqual([
      {
        organizationId: "org-1",
        projectId: null,
        actorId: "user-1",
        action: "auth.login_succeeded",
        targetType: "session",
        targetId: "session-1",
        metadata: {
          clientType: "desktop",
        },
        ipAddress: null,
        userAgent: null,
        createdAt: new Date("2026-07-05T00:00:00.000Z"),
      },
    ]);
  });

  test("returns invalid credentials for unknown email or wrong password", async () => {
    const { authRepository, auditRepository } = createTestRepositories();
    (authRepository as any).addUser({
      id: "user-1",
      name: "Ada Lovelace",
      email: "ada@example.com",
      passwordHash: "stored-password-hash",
    });
    const auth = new AuthService({
      authRepository,
      auditRepository,
      hashPassword: async (password) => `hashed:${password}`,
      verifyPassword: async () => false,
      createRefreshToken: () => "refresh-token",
      hashRefreshToken: async (token) => `hashed-refresh:${token}`,
      now: () => new Date("2026-07-05T00:00:00.000Z"),
    });

    await expect(
      auth.login({
        email: "missing@example.com",
        password: "correct-horse-battery",
        clientType: "web",
      }),
    ).resolves.toBeInstanceOf(InvalidCredentialsError);

    await expect(
      auth.login({
        email: "ada@example.com",
        password: "wrong-password",
        clientType: "web",
      }),
    ).resolves.toBeInstanceOf(InvalidCredentialsError);
  });

  test("returns the current user for a valid bearer refresh token", async () => {
    const { authRepository, auditRepository } = createTestRepositories();
    (authRepository as any).addUser({
      id: "user-1",
      name: "Ada Lovelace",
      email: "ada@example.com",
      passwordHash: "stored-password-hash",
    });
    const auth = new AuthService({
      authRepository,
      auditRepository,
      hashPassword: async (password) => `hashed:${password}`,
      verifyPassword: async () => true,
      createRefreshToken: () => "refresh-token",
      hashRefreshToken: async (token) => `hashed-refresh:${token}`,
      now: () => new Date("2026-07-05T00:00:00.000Z"),
    });

    await auth.login({
      email: "ada@example.com",
      password: "correct-horse-battery",
      clientType: "web",
    });

    const result = await auth.me({
      authorization: "Bearer refresh-token",
    });

    expect(result).not.toBeInstanceOf(AuthServiceError);
    if (result instanceof AuthServiceError) {
      throw new Error("Current user lookup unexpectedly failed");
    }

    expect(result).toEqual({
      user: {
        id: "user-1",
        name: "Ada Lovelace",
        email: "ada@example.com",
      },
      session: {
        id: "session-1",
        clientType: "web",
        expiresAt: "2026-07-12T00:00:00.000Z",
      },
    });
  });

  test("returns unauthorized for missing or unknown bearer refresh token", async () => {
    const { authRepository, auditRepository } = createTestRepositories();
    const auth = new AuthService({
      authRepository,
      auditRepository,
      hashPassword: async (password) => `hashed:${password}`,
      verifyPassword: async () => true,
      createRefreshToken: () => "refresh-token",
      hashRefreshToken: async (token) => `hashed-refresh:${token}`,
      now: () => new Date("2026-07-05T00:00:00.000Z"),
    });

    await expect(auth.me({ authorization: undefined })).resolves.toBeInstanceOf(UnauthorizedError);
    await expect(auth.me({ authorization: "Bearer missing-token" })).resolves.toBeInstanceOf(UnauthorizedError);
  });

  test("returns unauthorized for expired session", async () => {
    const { authRepository, auditRepository } = createTestRepositories();
    (authRepository as any).addUser({
      id: "user-1",
      name: "Ada Lovelace",
      email: "ada@example.com",
      passwordHash: "stored-password-hash",
    });
    const auth = new AuthService({
      authRepository,
      auditRepository,
      hashPassword: async (password) => `hashed:${password}`,
      verifyPassword: async () => true,
      createRefreshToken: () => "refresh-token",
      hashRefreshToken: async (token) => `hashed-refresh:${token}`,
      // Session was created 8 days ago — it has expired
      now: () => new Date("2026-06-27T00:00:00.000Z"),
    });

    await auth.login({
      email: "ada@example.com",
      password: "correct-horse-battery",
      clientType: "web",
    });

    // Now time has advanced past the 7-day TTL
    const now = new Date("2026-07-06T00:00:00.000Z");
    const expiredAuth = new AuthService({
      authRepository,
      auditRepository,
      hashPassword: async (password) => `hashed:${password}`,
      verifyPassword: async () => true,
      createRefreshToken: () => "refresh-token",
      hashRefreshToken: async (token) => `hashed-refresh:${token}`,
      now: () => now,
    });

    const result = await expiredAuth.me({
      authorization: "Bearer refresh-token",
    });

    expect(result).toBeInstanceOf(UnauthorizedError);
  });

  test("returns unauthorized for malformed authorization header", async () => {
    const { authRepository, auditRepository } = createTestRepositories();
    const auth = new AuthService({
      authRepository,
      auditRepository,
      hashPassword: async (password) => `hashed:${password}`,
      verifyPassword: async () => true,
      createRefreshToken: () => "refresh-token",
      hashRefreshToken: async (token) => `hashed-refresh:${token}`,
      now: () => new Date("2026-07-05T00:00:00.000Z"),
    });

    const results = await Promise.all([
      auth.me({ authorization: "NotBearer token" }),
      auth.me({ authorization: "Bearer " }),
      auth.me({ authorization: "" }),
    ]);

    for (const result of results) {
      expect(result).toBeInstanceOf(UnauthorizedError);
    }
  });

  test("defaults clientType to web when not provided", async () => {
    const { authRepository, auditRepository } = createTestRepositories();
    (authRepository as any).addUser({
      id: "user-1",
      name: "Ada Lovelace",
      email: "ada@example.com",
      passwordHash: "stored-password-hash",
    });
    const auth = new AuthService({
      authRepository,
      auditRepository,
      hashPassword: async (password) => `hashed:${password}`,
      verifyPassword: async () => true,
      createRefreshToken: () => "refresh-token",
      hashRefreshToken: async (token) => `hashed-refresh:${token}`,
      now: () => new Date("2026-07-05T00:00:00.000Z"),
    });

    const result = await auth.login({
      email: "ada@example.com",
      password: "correct-horse-battery",
    });

    expect(result).not.toBeInstanceOf(AuthServiceError);
    if (result instanceof AuthServiceError) return;
    expect(result.session.clientType).toBe("web");
  });

  test("returns invalid credentials for empty email or short password", async () => {
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

    await expect(
      auth.login({ email: "", password: "correct-horse-battery", clientType: "web" }),
    ).resolves.toBeInstanceOf(InvalidCredentialsError);

    await expect(
      auth.login({ email: "ada@example.com", password: "short", clientType: "web" }),
    ).resolves.toBeInstanceOf(InvalidCredentialsError);
  });
});
