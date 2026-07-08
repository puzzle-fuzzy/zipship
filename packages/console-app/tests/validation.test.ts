import { describe, expect, test } from "bun:test";
import {
  createProjectSchema,
  displayNameSchema,
  emailSchema,
  passwordSchema,
  projectSlugSchema,
} from "../src/lib/validation";

describe("projectSlugSchema", () => {
  test("accepts a well-formed slug", () => {
    expect(projectSlugSchema.safeParse("my-project_1").success).toBe(true);
  });

  test("rejects uppercase, spaces, and a leading hyphen", () => {
    expect(projectSlugSchema.safeParse("My-Project").success).toBe(false);
    expect(projectSlugSchema.safeParse("my project").success).toBe(false);
    expect(projectSlugSchema.safeParse("-leading").success).toBe(false);
  });

  test("rejects empty", () => {
    expect(projectSlugSchema.safeParse("").success).toBe(false);
    expect(projectSlugSchema.safeParse("   ").success).toBe(false);
  });
});

describe("emailSchema", () => {
  test("normalizes to lowercase and validates shape", () => {
    const result = emailSchema.safeParse("  ADA@Example.COM ");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("ada@example.com");
  });

  test("rejects malformed emails", () => {
    expect(emailSchema.safeParse("not-an-email").success).toBe(false);
    expect(emailSchema.safeParse("a@b").success).toBe(false);
  });
});

describe("passwordSchema", () => {
  test("enforces the 8-char minimum (matches the API)", () => {
    expect(passwordSchema.safeParse("short").success).toBe(false);
    expect(passwordSchema.safeParse("password123").success).toBe(true);
  });
});

describe("displayNameSchema", () => {
  test("trims and requires non-empty", () => {
    const r = displayNameSchema.safeParse("  Ada  ");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe("Ada");
    expect(displayNameSchema.safeParse("").success).toBe(false);
  });
});

describe("createProjectSchema", () => {
  test("accepts name + valid slug, optional description", () => {
    expect(
      createProjectSchema.safeParse({ name: "My Project", slug: "my-project", description: "" })
        .success,
    ).toBe(true);
    expect(
      createProjectSchema.safeParse({ name: "X", slug: "Bad Slug" }).success,
    ).toBe(false);
  });
});
