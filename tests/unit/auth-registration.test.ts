import { describe, expect, test } from "bun:test";
import { AuthServiceError, DuplicateEmailError } from "../../apps/api/src/modules/auth/model";
import { AuthService } from "../../apps/api/src/modules/auth/service";

function createRepository() {
  const emails = new Set<string>();
  const calls: unknown[] = [];

  return {
    calls,
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
    async createSession() {
      throw new Error("createSession is not used by registration tests");
    },
  };
}

describe("auth registration", () => {
  test("creates a user, default organization, and owner member", async () => {
    const repository = createRepository();
    const auth = new AuthService({
      repository,
      hashPassword: async (password) => `hashed:${password}`,
      verifyPassword: async () => false,
      createRefreshToken: () => "unused-refresh-token",
      hashRefreshToken: async (token) => `unused:${token}`,
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
    expect(repository.calls).toEqual([
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
    const repository = createRepository();
    const auth = new AuthService({
      repository,
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
