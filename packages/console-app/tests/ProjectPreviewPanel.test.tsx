import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectPreviewPanel } from "../src/features/project-detail/ProjectPreviewPanel";
import type { Release } from "../src/stores/projectsStore";
import { useSettingsStore } from "../src/stores/settingsStore";

beforeEach(() => {
  useSettingsStore.setState({ language: "en" });
});

function makeRelease(): Release {
  return {
    id: "release-1",
    projectId: "project-1",
    versionNumber: 7,
    releaseHash: "abcdef123456",
    previewUrl: null,
    fullHash: "full",
    status: "ready",
    storagePath: "/tmp/site",
    rawUploadPath: "/tmp/upload.zip",
    fileCount: 3,
    totalSize: 4096,
    manifest: {},
    detectResult: {},
    createdBy: "user-1",
    createdAt: "2026-07-09T00:00:00.000Z",
    activatedAt: null,
    archivedAt: null,
  };
}

describe("ProjectPreviewPanel", () => {
  it("renders an iframe preview and opens the selected release", async () => {
    const onOpenPreview = vi.fn();

    render(
      <ProjectPreviewPanel
        release={makeRelease()}
        previewUrl="http://localhost:3001/_sites/demo/abcdef123456/"
        canUpload={true}
        onOpenPreview={onOpenPreview}
        onUploadClick={() => {}}
      />,
    );

    expect(screen.getByTitle("Preview v7")).toHaveAttribute(
      "src",
      "http://localhost:3001/_sites/demo/abcdef123456/",
    );

    await userEvent.click(screen.getByRole("button", { name: "Mobile" }));
    expect(screen.getByRole("button", { name: "Mobile" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Open preview" }));
    expect(onOpenPreview).toHaveBeenCalledWith(expect.objectContaining({ id: "release-1" }));
  });

  it("shows an upload empty state without a release", async () => {
    const onUploadClick = vi.fn();

    render(
      <ProjectPreviewPanel
        release={null}
        previewUrl={null}
        canUpload={true}
        onOpenPreview={() => {}}
        onUploadClick={onUploadClick}
      />,
    );

    expect(screen.getByText("No previewable version")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Upload build" })[0]);
    expect(onUploadClick).toHaveBeenCalled();
  });

  it("explains why upload is disabled for read-only users", () => {
    render(
      <ProjectPreviewPanel
        release={null}
        previewUrl={null}
        canUpload={false}
        onOpenPreview={() => {}}
        onUploadClick={() => {}}
      />,
    );

    expect(screen.getByText(/Ask an owner, admin, or developer/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Upload build" })[0]).toBeDisabled();
  });
});
