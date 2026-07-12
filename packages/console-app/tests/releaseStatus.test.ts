import { describe, expect, it, vi } from "vitest";
import { releaseStatusBadgeClass, releaseStatusLabel } from "../src/features/project-detail/releaseStatus";

/** A fake `t` that echoes the key, so we assert which i18n key each status maps to. */
const t = vi.fn((key: string) => key) as unknown as (k: string) => string;

describe("releaseStatusLabel", () => {
  it("maps known statuses to their i18n key", () => {
    expect(releaseStatusLabel("active", t)).toBe("versions.status.active");
    expect(releaseStatusLabel("ready", t)).toBe("versions.status.ready");
    expect(releaseStatusLabel("failed", t)).toBe("versions.status.failed");
    expect(releaseStatusLabel("archived", t)).toBe("versions.status.archived");
    expect(releaseStatusLabel("deleted", t)).toBe("versions.status.deleted");
  });

  it("falls back to the raw status for unknown values", () => {
    expect(releaseStatusLabel("superseded", t)).toBe("superseded");
    expect(releaseStatusLabel("", t)).toBe("");
  });
});

describe("releaseStatusBadgeClass", () => {
  it("returns a distinct class for active (the highlighted one)", () => {
    expect(releaseStatusBadgeClass("active")).toBe("border-primary/20 bg-primary/10 text-primary");
  });

  it("marks failed as destructive", () => {
    expect(releaseStatusBadgeClass("failed")).toContain("destructive");
  });

  it("returns a non-empty class for every known and unknown status", () => {
    for (const s of ["active", "ready", "uploading", "processing", "failed", "archived", "deleted", "unknown"]) {
      expect(releaseStatusBadgeClass(s).length).toBeGreaterThan(0);
    }
  });

  it("treats archived and deleted identically (muted)", () => {
    expect(releaseStatusBadgeClass("archived")).toBe(releaseStatusBadgeClass("deleted"));
  });
});
