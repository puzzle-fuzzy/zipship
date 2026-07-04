import { treaty } from "@elysia/eden";
import { describe, expect, test } from "bun:test";
import { createApp } from "../../apps/api/src/index";

describe("auth routes", () => {
  test("registers a user through Eden Treaty", async () => {
    const api = treaty(createApp());

    const response = await api._api.auth.register.post({
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: "correct-horse-battery",
    });

    expect(response.status).toBe(201);
    expect(response.data).toMatchObject({
      user: {
        email: "ada@example.com",
      },
      organization: {
        slug: "ada",
      },
      member: {
        role: "owner",
      },
    });
  });

  test("returns conflict for duplicate email addresses", async () => {
    const api = treaty(createApp());

    await api._api.auth.register.post({
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: "correct-horse-battery",
    });

    const response = await api._api.auth.register.post({
      name: "Ada Again",
      email: " ADA@example.com ",
      password: "correct-horse-battery",
    });

    expect(response.status).toBe(409);
    expect((response.error?.value as unknown)).toEqual({
      code: "DUPLICATE_EMAIL",
    });
  });
});
