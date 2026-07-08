import { describe, expect, test } from "bun:test";
import {
  ZIPSHIP_RESERVED_SLUGS,
  MEMBER_ROLES,
  RELEASE_STATUSES,
  DEPLOYMENT_ACTIONS,
} from "../src";

describe("shared contracts", () => {
  test("reserved slugs include the control-plane / access-plane prefixes", () => {
    const reserved = ZIPSHIP_RESERVED_SLUGS as readonly string[];
    for (const slug of ["_api", "_console", "_health", "_assets"]) {
      expect(reserved).toContain(slug);
    }
  });

  test("MEMBER_ROLES is the single source of truth and matches the 5 RBAC roles", () => {
    expect(MEMBER_ROLES).toEqual([
      "owner",
      "admin",
      "developer",
      "deployer",
      "viewer",
    ]);
  });

  test("RELEASE_STATUSES covers the full lifecycle", () => {
    expect(RELEASE_STATUSES).toEqual([
      "uploading",
      "processing",
      "ready",
      "active",
      "failed",
      "archived",
      "deleted",
    ]);
  });

  test("DEPLOYMENT_ACTIONS", () => {
    expect(DEPLOYMENT_ACTIONS).toEqual(["publish", "rollback", "promote", "archive"]);
  });
});
