import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectVersionsTab } from "../src/features/project-detail/ProjectVersionsTab";
import type { Release } from "../src/stores/projectsStore";
import { useSettingsStore } from "../src/stores/settingsStore";

beforeEach(() => {
  useSettingsStore.setState({ language: "en" });
});

function makeRelease(overrides: Partial<Release> = {}): Release {
  return {
    id: "release-1",
    projectId: "project-1",
    versionNumber: 1,
    releaseHash: "abcdef123456",
    previewUrl: "/_sites/demo/abcdef123456/",
    fullHash: "full",
    status: "ready",
    storagePath: "/tmp/site",
    rawUploadPath: "/tmp/upload.zip",
    fileCount: 3,
    totalSize: 4096,
    manifest: {},
    detectResult: {
      level: "warning",
      items: [{ level: "warning", code: "ROOT_ASSET_PATH_DETECTED" }],
      insights: {
        entrypoint: "index.html",
        assets: { totalFiles: 3, totalSize: 4096 },
        seo: {
          score: 67,
          checks: [{ code: "SEO_DESCRIPTION_MISSING", status: "warning" }],
        },
      },
      runtime: {
        level: "warning",
        url: "http://localhost:3001/_sites/demo/abcdef123456/",
        snapshot: {
          status: 200,
          consoleMessages: [{ type: "error", text: "boom" }],
          failedRequests: [],
        },
        items: [{ level: "warning", code: "RUNTIME_CONSOLE_ERRORS" }],
      },
    },
    createdBy: "user-1",
    createdAt: "2026-07-09T00:00:00.000Z",
    activatedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

describe("ProjectVersionsTab", () => {
  it("expands a version and shows artifact and SEO report data", async () => {
    render(
      <ProjectVersionsTab
        loading={false}
        error={null}
        autoRefreshing={false}
        canUpload={true}
        canDeploy={true}
        canDelete={true}
        onUploadClick={() => {}}
        onRetry={() => {}}
        onPreview={() => {}}
        onPublish={async () => {}}
        onRollback={async () => {}}
        releases={[makeRelease()]}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Report" }));

    expect(screen.getByText("index.html")).toBeInTheDocument();
    expect(screen.getAllByText("Score 67").length).toBeGreaterThan(0);
    expect(screen.getByText("Release check report")).toBeInTheDocument();
    expect(screen.getByText("HTTP 200")).toBeInTheDocument();
    expect(screen.getAllByText("Console errors").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
    expect(screen.getByText("Missing description")).toBeInTheDocument();
    expect(screen.getByText("Root asset path")).toBeInTheDocument();
    expect(screen.getByText(/Add <meta name="description"/)).toBeInTheDocument();
    expect(screen.getByText(/base: ".\/"/)).toBeInTheDocument();
    expect(screen.getByText(/fix the first console error/)).toBeInTheDocument();
  });

  it("confirms before publishing a ready version", async () => {
    const user = userEvent.setup();
    const onPublish = vi.fn(async () => {});

    render(
      <ProjectVersionsTab
        loading={false}
        error={null}
        autoRefreshing={false}
        canUpload={true}
        canDeploy={true}
        canDelete={true}
        onUploadClick={() => {}}
        onRetry={() => {}}
        onPreview={() => {}}
        onPublish={onPublish}
        onRollback={async () => {}}
        releases={[makeRelease()]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Publish" }));

    expect(screen.getByRole("heading", { name: "Publish this version?" })).toBeInTheDocument();
    expect(screen.getByText("Pre-publish quality check")).toBeInTheDocument();
    expect(screen.getByText("3 warnings were found. Review them before changing production traffic.")).toBeInTheDocument();
    expect(screen.getByText("Root asset path")).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("What changed in this release?"), "  Ship homepage fixes  ");

    const confirmButtons = screen.getAllByRole("button", { name: "Publish" });
    await user.click(confirmButtons[confirmButtons.length - 1]!);

    expect(onPublish).toHaveBeenCalledTimes(1);
    expect(onPublish).toHaveBeenCalledWith(expect.objectContaining({ id: "release-1" }), "Ship homepage fixes");
  });

  it("uses rollback confirmation for an older ready version", async () => {
    const user = userEvent.setup();
    const onRollback = vi.fn(async () => {});
    const olderReady = makeRelease({ id: "release-1", versionNumber: 1, status: "ready" });
    const active = makeRelease({
      id: "release-2",
      versionNumber: 2,
      status: "active",
      releaseHash: "fedcba654321",
    });

    render(
      <ProjectVersionsTab
        loading={false}
        error={null}
        autoRefreshing={false}
        canUpload={true}
        canDeploy={true}
        canDelete={true}
        onUploadClick={() => {}}
        onRetry={() => {}}
        onPreview={() => {}}
        onPublish={async () => {}}
        onRollback={onRollback}
        releases={[active, olderReady]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Rollback" }));

    expect(screen.getByRole("heading", { name: "Roll back to this version?" })).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("Why are you rolling back?"), "Bad deploy");

    const confirmButtons = screen.getAllByRole("button", { name: "Roll back" });
    await user.click(confirmButtons[confirmButtons.length - 1]!);

    expect(onRollback).toHaveBeenCalledTimes(1);
    expect(onRollback).toHaveBeenCalledWith(olderReady, "Bad deploy");
  });

  it("shows a retry action when versions fail to load", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(
      <ProjectVersionsTab
        loading={false}
        error="Failed to load releases"
        autoRefreshing={false}
        canUpload={true}
        canDeploy={true}
        canDelete={true}
        onUploadClick={() => {}}
        onRetry={onRetry}
        onPreview={() => {}}
        onPublish={async () => {}}
        onRollback={async () => {}}
        releases={[]}
      />,
    );

    expect(screen.getByText("Could not load versions")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows when release processing is being watched", () => {
    render(
      <ProjectVersionsTab
        loading={false}
        error={null}
        autoRefreshing={true}
        canUpload={true}
        canDeploy={true}
        canDelete={true}
        onUploadClick={() => {}}
        onRetry={() => {}}
        onPreview={() => {}}
        onPublish={async () => {}}
        onRollback={async () => {}}
        releases={[makeRelease({ status: "processing" })]}
      />,
    );

    expect(screen.getByText("Watching release processing")).toBeInTheDocument();
  });

  it("highlights and expands the release selected after upload", () => {
    render(
      <ProjectVersionsTab
        loading={false}
        error={null}
        autoRefreshing={false}
        highlightedReleaseId="release-2"
        canUpload={true}
        canDeploy={true}
        canDelete={true}
        onUploadClick={() => {}}
        onRetry={() => {}}
        onPreview={() => {}}
        onPublish={async () => {}}
        onRollback={async () => {}}
        releases={[
          makeRelease({ id: "release-2", versionNumber: 2, releaseHash: "newhash123456" }),
          makeRelease({ id: "release-1", versionNumber: 1 }),
        ]}
      />,
    );

    expect(screen.getByText("New upload")).toBeInTheDocument();
    expect(screen.getByText("Release check report")).toBeInTheDocument();
    expect(screen.getByText("newhash123456")).toBeInTheDocument();
  });
});
