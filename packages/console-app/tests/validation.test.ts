import { describe, expect, test } from "vitest";
import {
  createProjectSchema,
  displayNameSchema,
  emailSchema,
  passwordSchema,
  projectNameSchema,
  projectSlugSchema,
} from "../src/lib/validation";

/**
 * Client-side validation mirrors the server rules (see `isValidProjectSlug`
 * in `@zipship/deploy-core` and the auth model). These schemas are the first
 * line of defense before anything hits the API, so we pin their behaviour.
 */
describe("projectSlugSchema", () => {
  test("accepts lowercase slugs with numbers, hyphens, underscores", () => {
    expect(projectSlugSchema.safeParse("admin").success).toBe(true);
    expect(projectSlugSchema.safeParse("admin-v2").success).toBe(true);
    expect(projectSlugSchema.safeParse("admin_v2").success).toBe(true);
    expect(projectSlugSchema.safeParse("1st").success).toBe(true);
  });

  test("trims surrounding whitespace before validating", () => {
    expect(projectSlugSchema.safeParse("  admin  ").success).toBe(true);
  });

  test("rejects uppercase, leading underscore/hyphen, special chars, empty", () => {
    const cases = ["Admin", "_admin", "-admin", "admin!", "admin space", "", "   "];
    for (const c of cases) {
      expect(projectSlugSchema.safeParse(c).success).toBe(false);
    }
  });

  test("rejects slugs longer than 80 characters", () => {
    expect(projectSlugSchema.safeParse("a".repeat(80)).success).toBe(true);
    expect(projectSlugSchema.safeParse("a".repeat(81)).success).toBe(false);
  });

  test("reports a required message for empty input", () => {
    const result = projectSlugSchema.safeParse("");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Slug is required");
    }
  });
});

describe("projectNameSchema", () => {
  test("accepts 1–160 chars and trims", () => {
    expect(projectNameSchema.safeParse("Marketing Site").success).toBe(true);
    expect(projectNameSchema.safeParse("  x  ").data).toBe("x");
  });

  test("rejects empty and over-limit", () => {
    expect(projectNameSchema.safeParse("").success).toBe(false);
    expect(projectNameSchema.safeParse("a".repeat(161)).success).toBe(false);
  });
});

describe("displayNameSchema", () => {
  test("accepts 1–120 chars and trims", () => {
    const r = displayNameSchema.safeParse("  Ada  ");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe("Ada");
    expect(displayNameSchema.safeParse("a".repeat(120)).success).toBe(true);
  });

  test("rejects empty and over 120 chars", () => {
    expect(displayNameSchema.safeParse("").success).toBe(false);
    expect(displayNameSchema.safeParse("a".repeat(121)).success).toBe(false);
  });
});

describe("emailSchema", () => {
  test("normalizes to lowercase and validates format", () => {
    expect(emailSchema.safeParse("  ADA@Example.COM ").data).toBe("ada@example.com");
    expect(emailSchema.safeParse("user@example.com").success).toBe(true);
  });

  test("rejects malformed emails", () => {
    expect(emailSchema.safeParse("not-an-email").success).toBe(false);
    expect(emailSchema.safeParse("@example.com").success).toBe(false);
    expect(emailSchema.safeParse("a@").success).toBe(false);
    expect(emailSchema.safeParse("").success).toBe(false);
  });
});

describe("passwordSchema", () => {
  test("requires at least 8 and at most 128 characters", () => {
    expect(passwordSchema.safeParse("1234567").success).toBe(false);
    expect(passwordSchema.safeParse("12345678").success).toBe(true);
    expect(passwordSchema.safeParse("a".repeat(128)).success).toBe(true);
    expect(passwordSchema.safeParse("a".repeat(129)).success).toBe(false);
  });

  test("reports a minimum-length message", () => {
    const result = passwordSchema.safeParse("short");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Password must be at least 8 characters");
    }
  });
});

describe("createProjectSchema", () => {
  test("accepts a full create-project payload", () => {
    expect(
      createProjectSchema.safeParse({
        name: "Marketing Site",
        slug: "marketing-site",
        description: "Launch pages",
      }).success,
    ).toBe(true);
  });

  test("description is optional or empty", () => {
    expect(createProjectSchema.safeParse({ name: "X", slug: "x" }).success).toBe(true);
    expect(
      createProjectSchema.safeParse({ name: "X", slug: "x", description: "" }).success,
    ).toBe(true);
  });

  test("rejects when the slug is invalid even if the name is fine", () => {
    expect(createProjectSchema.safeParse({ name: "X", slug: "_bad" }).success).toBe(false);
    expect(createProjectSchema.safeParse({ name: "X", slug: "Bad Slug" }).success).toBe(false);
  });

  test("rejects a description over 1000 chars", () => {
    expect(
      createProjectSchema.safeParse({ name: "X", slug: "x", description: "d".repeat(1001) })
        .success,
    ).toBe(false);
  });
});
