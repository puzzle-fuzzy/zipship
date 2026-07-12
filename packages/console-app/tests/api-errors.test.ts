import { describe, expect, test } from "vitest";
import {
  API_ERROR_MESSAGES,
  getApiErrorCode,
  mapApiError,
  type TreatyError,
} from "../src/api/errors";

/**
 * `mapApiError`/`getApiErrorCode` are the single source of truth for turning a
 * treaty error response into a user-facing message. Every store calls them, so
 * we pin their contract here.
 */
describe("getApiErrorCode", () => {
  test("extracts the stable code from a treaty error body", () => {
    const res: TreatyError = { status: 401, error: { value: { code: "UNAUTHORIZED" } } };
    expect(getApiErrorCode(res)).toBe("UNAUTHORIZED");
  });

  test("returns undefined when there is no body or no code", () => {
    expect(getApiErrorCode(null)).toBeUndefined();
    expect(getApiErrorCode(undefined)).toBeUndefined();
    expect(getApiErrorCode({ status: 500 })).toBeUndefined();
    expect(getApiErrorCode({ status: 500, error: { value: {} } })).toBeUndefined();
  });

  test("does not throw when the body is a non-object (string/number)", () => {
    expect(getApiErrorCode({ status: 500, error: { value: "plain string" } })).toBeUndefined();
    expect(getApiErrorCode({ status: 500, error: { value: 42 } })).toBeUndefined();
  });
});

describe("mapApiError", () => {
  test("returns the mapped message for a known code", () => {
    const res: TreatyError = {
      status: 401,
      error: { value: { code: "INVALID_CREDENTIALS" } },
    };
    const err = mapApiError(res, {
      codes: { INVALID_CREDENTIALS: "bad creds" },
      fallback: "Login failed",
    });
    expect(err.message).toBe("bad creds");
  });

  test("falls back when the code is unknown", () => {
    const res: TreatyError = { status: 500, error: { value: { code: "MYSTERY" } } };
    const err = mapApiError(res, { codes: {}, fallback: "Something went wrong" });
    expect(err.message).toBe("Something went wrong");
  });

  test("falls back when there is no code at all", () => {
    const res: TreatyError = { status: 500 };
    expect(mapApiError(res, { codes: {}, fallback: "Network error" }).message).toBe(
      "Network error",
    );
  });

  test("returns an Error instance", () => {
    const res: TreatyError = { status: 400, error: { value: { code: "X" } } };
    expect(mapApiError(res, { codes: {}, fallback: "f" })).toBeInstanceOf(Error);
  });
});

describe("API_ERROR_MESSAGES", () => {
  test("covers the stable codes the backend emits", () => {
    const expected = [
      "UNAUTHORIZED",
      "FORBIDDEN",
      "VALIDATION_ERROR",
      "NOT_FOUND",
      "INVALID_CREDENTIALS",
      "DUPLICATE_EMAIL",
      "INVALID_INPUT",
      "DUPLICATE_PROJECT_SLUG",
      "PROJECT_NOT_FOUND",
      "RELEASE_NOT_FOUND",
      "USER_NOT_FOUND",
      "ALREADY_MEMBER",
      "INVITATION_PENDING",
    ];
    for (const code of expected) {
      expect(API_ERROR_MESSAGES[code]).toBeTruthy();
    }
  });
});
