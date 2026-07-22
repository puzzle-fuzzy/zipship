import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectProductionPanel } from "../src/features/project-detail/ProjectProductionPanel";
import { buildProductionUrls } from "../src/features/project-detail/projectProductionUrls";
import type { Release } from "../src/stores/projectsStore";
import { useSettingsStore } from "../src/stores/settingsStore";
import { RuntimeProvider } from "../src/runtime-provider";
import type { RuntimeAdapter } from "@zipship/runtime";

let writeTextMock: ReturnType<typeof vi.fn>;
let openExternalMock: ReturnType<typeof vi.fn>;
let runtime: RuntimeAdapter;

beforeEach(() => {
  useSettingsStore.setState({ language: "en" });
  openExternalMock = vi.fn().mockResolvedValue(undefined);
  runtime = { kind: "web", openExternal: openExternalMock };
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
    fileCount: 12,
    totalSize: 4096,
    manifest: {},
    detectResult: { level: "pass", items: [] },
    createdBy: "user-1",
    createdAt: "2026-07-09T00:00:00.000Z",
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

    renderPanel(
      <ProjectProductionPanel
        projectSlug="demo"
        activeRelease={makeRelease()}
        canUpload={true}
        onUploadClick={() => {}}
      />,
    );

    expect(screen.getByText("Production")).toBeInTheDocument();
    expect(screen.getByText("http://localhost:5007/demo/")).toBeInTheDocument();
    expect(screen.getByText("http://localhost:5007/_sites/demo/release-1/")).toBeInTheDocument();
    expect(screen.getByText("v4")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Copy live production URL" }));
    await waitFor(() => expect(writeTextMock).toHaveBeenCalledWith("http://localhost:5007/demo/"));

    await user.click(screen.getByRole("button", { name: "Open production" }));
    await waitFor(() =>
      expect(openExternalMock).toHaveBeenCalledWith("http://localhost:5007/demo/"),
    );
  });

  it("shows an empty production state before a release is active", () => {
    renderPanel(
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

  it("builds live and pinned URLs from the independent Access Plane origin", () => {
    expect(buildProductionUrls("http://access.example/", "demo", "release-1")).toEqual({
      liveUrl: "http://access.example/demo/",
      pinnedUrl: "http://access.example/_sites/demo/release-1/",
    });
  });
});

function renderPanel(panel: React.ReactNode) {
  return render(<RuntimeProvider runtime={runtime}>{panel}</RuntimeProvider>);
}
