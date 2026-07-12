import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectProductionPanel, buildProductionUrls } from "../src/features/project-detail/ProjectProductionPanel";
import type { Release } from "../src/stores/projectsStore";
import { useSettingsStore } from "../src/stores/settingsStore";

let writeTextMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  useSettingsStore.setState({ language: "en" });
});

function makeRelease(overrides: Partial<Release> = {}): Release {
  return {
    id: "release-1",
    projectId: "project-1",
    versionNumber: 4,
    releaseHash: "abcdef123456",
    previewUrl: null,
    fullHash: "full",
    status: "active",
    storagePath: "/tmp/site",
    rawUploadPath: "/tmp/upload.zip",
    fileCount: 12,
    totalSize: 4096,
    manifest: {},
    detectResult: { level: "pass", items: [] },
    createdBy: "user-1",
    createdAt: "2026-07-09T00:00:00.000Z",
    activatedAt: "2026-07-09T00:00:00.000Z",
    archivedAt: null,
    ...overrides,
  };
}

describe("ProjectProductionPanel", () => {
  it("renders live and pinned production URLs for the active release", async () => {
    const user = userEvent.setup();
    writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: writeTextMock,
      },
    });

    render(
      <ProjectProductionPanel
        projectSlug="demo"
        activeRelease={makeRelease()}
        canUpload={true}
        onUploadClick={() => {}}
      />,
    );

    expect(screen.getByText("Production")).toBeInTheDocument();
    expect(screen.getByText("http://localhost:3000/demo/")).toBeInTheDocument();
    expect(screen.getByText("http://localhost:3000/demo/abcdef123456/")).toBeInTheDocument();
    expect(screen.getByText("v4")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Copy live production URL" }));
    await waitFor(() => expect(writeTextMock).toHaveBeenCalledWith("http://localhost:3000/demo/"));
  });

  it("shows an empty production state before a release is active", () => {
    render(
      <ProjectProductionPanel
        projectSlug="demo"
        activeRelease={undefined}
        canUpload={false}
        onUploadClick={() => {}}
      />,
    );

    expect(screen.getByText("No version is published to production yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload build" })).toBeDisabled();
  });

  it("builds live and pinned URLs from the current origin", () => {
    expect(buildProductionUrls("demo", "abcdef123456")).toEqual({
      liveUrl: "http://localhost:3000/demo/",
      pinnedUrl: "http://localhost:3000/demo/abcdef123456/",
    });
  });
});
