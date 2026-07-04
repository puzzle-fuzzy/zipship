import { describe, expect, test } from "bun:test";
import { AuthServiceError, InvalidCredentialsError, UnauthorizedError } from "../../apps/api/src/modules/auth/model";
import { AuthService } from "../../apps/api/src/modules/auth/service";

function createRepository() {
  const users = new Map<string, { id: string; name: string; email: string; passwordHash: string }>();
  const sessions: unknown[] = [];

  return {
    sessions,
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
  };
}

describe("auth login", () => {
  test("returns a session and refresh token for valid credentials", async () => {
    const repository = createRepository();
    repository.addUser({
      id: "user-1",
      name: "Ada Lovelace",
      email: "ada@example.com",
      passwordHash: "stored-password-hash",
    });
    const expiresAt = new Date("2026-07-12T00:00:00.000Z");
    const auth = new AuthService({
      repository,
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
    expect(repository.sessions).toEqual([
      {
        userId: "user-1",
        clientType: "desktop",
        refreshTokenHash: "hashed-refresh:refresh-token",
        expiresAt,
      },
    ]);
  });

  test("returns invalid credentials for unknown email or wrong password", async () => {
    const repository = createRepository();
    repository.addUser({
      id: "user-1",
      name: "Ada Lovelace",
      email: "ada@example.com",
      passwordHash: "stored-password-hash",
    });
    const auth = new AuthService({
      repository,
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
    const repository = createRepository();
    repository.addUser({
      id: "user-1",
      name: "Ada Lovelace",
      email: "ada@example.com",
      passwordHash: "stored-password-hash",
    });
    const auth = new AuthService({
      repository,
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
    const auth = new AuthService({
      repository: createRepository(),
      hashPassword: async (password) => `hashed:${password}`,
      verifyPassword: async () => true,
      createRefreshToken: () => "refresh-token",
      hashRefreshToken: async (token) => `hashed-refresh:${token}`,
      now: () => new Date("2026-07-05T00:00:00.000Z"),
    });

    await expect(auth.me({ authorization: undefined })).resolves.toBeInstanceOf(UnauthorizedError);
    await expect(auth.me({ authorization: "Bearer missing-token" })).resolves.toBeInstanceOf(UnauthorizedError);
  });
});
