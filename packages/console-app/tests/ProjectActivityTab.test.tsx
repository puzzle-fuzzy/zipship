import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ProjectActivityTab } from "../src/features/project-detail/ProjectActivityTab";
import type { AuditLogEntry } from "../src/stores/auditStore";
import { useSettingsStore } from "../src/stores/settingsStore";

/**
 * Exercises the Testing Library foundation (jsdom + RTL + vitest) against a real
 * presentational component, and pins the Activity tab's four states:
 * loading / error+retry / empty / list.
 *
 * The settings store defaults to Chinese; we pin English so the asserted copy
 * is stable and readable.
 */

beforeEach(() => {
  useSettingsStore.setState({ language: "en" });
});

/**
 * Exercises the Testing Library foundation (jsdom + RTL + vitest) against a real
 * presentational component, and pins the Activity tab's four states:
 * loading / error+retry / empty / list.
 */

function makeLog(over: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: "a1",
    action: "release.published",
    actorId: "u1",
    targetType: "release",
    targetId: "r1",
    projectId: "p1",
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("ProjectActivityTab", () => {
  it("shows the loading state while loading", () => {
    render(
      <ProjectActivityTab logs={[]} loading={true} error={null} onRetry={() => {}} />,
    );
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("shows the empty state when there are no logs", () => {
    render(<ProjectActivityTab logs={[]} loading={false} error={null} onRetry={() => {}} />);
    expect(screen.getByText("No activity yet")).toBeInTheDocument();
  });

  it("shows an error message and a retry button, and retry calls back", () => {
    const onRetry = vi.fn();
    render(
      <ProjectActivityTab logs={[]} loading={false} error="Failed to load activity" onRetry={onRetry} />,
    );
    expect(screen.getByText("Failed to load activity")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Retry"));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("renders the audit log rows", () => {
    render(
      <ProjectActivityTab
        logs={[makeLog({ id: "a1" }), makeLog({ id: "a2", action: "member.invited" })]}
        loading={false}
        error={null}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText("release.published")).toBeInTheDocument();
    expect(screen.getByText("member.invited")).toBeInTheDocument();
  });
});
