import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectDeploymentsTab } from "../src/features/project-detail/ProjectDeploymentsTab";
import type { Deployment, Release } from "../src/stores/projectsStore";
import { useSettingsStore } from "../src/stores/settingsStore";

beforeEach(() => {
  useSettingsStore.setState({ language: "en" });
});

function makeRelease(overrides: Partial<Release> = {}): Release {
  return {
    id: "release-1",
    projectId: "project-1",
    versionNumber: 3,
    releaseHash: "abcdef123456",
    previewUrl: null,
    fullHash: "full",
    status: "active",
    fileCount: 3,
    totalSize: 4096,
    manifest: {},
    detectResult: {},
    createdBy: "user-1",
    createdAt: "2026-07-09T00:00:00.000Z",
    archivedAt: null,
    ...overrides,
  };
}

function makeDeployment(overrides: Partial<Deployment> = {}): Deployment {
  return {
    id: "deployment-1",
    projectId: "project-1",
    releaseId: "release-1",
    previousReleaseId: "release-0",
    action: "publish",
    status: "success",
    operatorId: "operator-123456",
    message: "Ship homepage",
    createdAt: "2026-07-09T00:00:00.000Z",
    finishedAt: null,
    ...overrides,
  };
}

describe("ProjectDeploymentsTab", () => {
  it("renders deployment history with release context", () => {
    render(
      <ProjectDeploymentsTab
        deployments={[makeDeployment()]}
        releases={[makeRelease(), makeRelease({ id: "release-0", versionNumber: 2, releaseHash: "bbbbbb123456" })]}
        loading={false}
        error={null}
        onRetry={() => {}}
      />,
    );

    expect(screen.getByText("Deployments")).toBeInTheDocument();
    expect(screen.getByText("Published release")).toBeInTheDocument();
    expect(screen.getByText(/Target v3/)).toBeInTheDocument();
    expect(screen.getByText(/Previous v2/)).toBeInTheDocument();
    expect(screen.getByText("Deployment note")).toBeInTheDocument();
    expect(screen.getByText("Ship homepage")).toBeInTheDocument();
  });

  it("shows deployment quality and artifact snapshot", () => {
    render(
      <ProjectDeploymentsTab
        deployments={[makeDeployment()]}
        releases={[
          makeRelease({
            detectResult: {
              level: "warning",
              items: [{ level: "warning", code: "ROOT_ASSET_PATH_DETECTED" }],
              runtime: {
                level: "warning",
                snapshot: {
                  status: 200,
                  consoleMessages: [],
                  failedRequests: [],
                },
                items: [],
              },
            },
          }),
        ]}
        loading={false}
        error={null}
        onRetry={() => {}}
      />,
    );

    expect(screen.getByText("Quality")).toBeInTheDocument();
    expect(screen.getAllByText("Warning").length).toBeGreaterThan(0);
    expect(screen.getByText("Runtime")).toBeInTheDocument();
    expect(screen.getByText("Artifact")).toBeInTheDocument();
    expect(screen.getByText("3 files")).toBeInTheDocument();
  });

  it("shows retry when deployment history fails to load", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(
      <ProjectDeploymentsTab
        deployments={[]}
        releases={[]}
        loading={false}
        error="Failed to load deployment history"
        onRetry={onRetry}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
