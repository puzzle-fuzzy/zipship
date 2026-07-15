import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectDetailHeader } from "../src/features/project-detail/ProjectDetailHeader";
import type { Project, Release } from "../src/stores/projectsStore";
import { useSettingsStore } from "../src/stores/settingsStore";

beforeEach(() => {
  useSettingsStore.setState({ language: "en" });
});

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    organizationId: "org-1",
    name: "Demo Site",
    slug: "demo",
    description: "Static deployment workspace",
    currentReleaseId: null,
    spaFallback: true,
    cachePolicy: "standard",
    createdBy: "user-1",
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
    ...overrides,
  };
}

function makeRelease(overrides: Partial<Release> = {}): Release {
  return {
    id: "release-1",
    projectId: "project-1",
    versionNumber: 1,
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

describe("ProjectDetailHeader", () => {
  it("renders project identity and opens the active release", async () => {
    const user = userEvent.setup();
    const activeRelease = makeRelease();
    const onOpenActiveRelease = vi.fn();

    render(
      <ProjectDetailHeader
        project={makeProject()}
        activeRelease={activeRelease}
        canUpload={true}
        onOpenActiveRelease={onOpenActiveRelease}
        onUploadClick={() => {}}
      />,
    );

    expect(screen.getByRole("heading", { name: "Demo Site" })).toBeInTheDocument();
    expect(screen.getByText("/demo")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(onOpenActiveRelease).toHaveBeenCalledWith(activeRelease);
  });

  it("disables upload when the user cannot upload releases", () => {
    render(
      <ProjectDetailHeader
        project={makeProject({ description: null })}
        activeRelease={undefined}
        canUpload={false}
        onOpenActiveRelease={() => {}}
        onUploadClick={() => {}}
      />,
    );

    expect(screen.queryByRole("button", { name: "Preview" })).not.toBeInTheDocument();
    expect(screen.getByText("Publish a version to see the URL")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish version" })).toBeDisabled();
  });
});
