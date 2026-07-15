import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectSettingsTab } from "../src/features/project-detail/ProjectSettingsTab";
import type { Project, Release } from "../src/stores/projectsStore";
import { useSettingsStore } from "../src/stores/settingsStore";

beforeEach(() => {
  useSettingsStore.setState({ language: "en" });
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    organizationId: "org-1",
    name: "Demo Site",
    slug: "demo",
    description: "Static site",
    currentReleaseId: "release-1",
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
    ...overrides,
  };
}

function renderSettings(overrides: Partial<React.ComponentProps<typeof ProjectSettingsTab>> = {}) {
  return render(
    <MemoryRouter>
      <ProjectSettingsTab
        project={makeProject()}
        activeRelease={makeRelease()}
        canManage={true}
        onSave={async () => {}}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

describe("ProjectSettingsTab", () => {
  it("renders production access paths and policies", () => {
    renderSettings();

    expect(screen.getByText("Project profile")).toBeInTheDocument();
    expect(screen.getByText("Production access")).toBeInTheDocument();
    expect(screen.getByText("/demo/")).toBeInTheDocument();
    expect(screen.getByText("/demo/abcdef123456/")).toBeInTheDocument();
    expect(screen.getAllByText("SPA fallback").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Cache policy").length).toBeGreaterThan(0);
    expect(screen.getByText("Reserved paths")).toBeInTheDocument();
    expect(screen.getByText("HTML cache")).toBeInTheDocument();
    expect(screen.getByText("Asset cache")).toBeInTheDocument();
    expect(screen.getByText("public, max-age=3600")).toBeInTheDocument();
  });

  it("saves only editable project profile fields", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => {});

    renderSettings({ onSave });

    await user.clear(screen.getByLabelText("Project name"));
    await user.type(screen.getByLabelText("Project name"), "Docs Site");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith({
      name: "Docs Site",
      slug: "demo",
      description: "Static site",
    });
  });

  it("saves editable production access fields", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => {});

    renderSettings({ onSave });

    await user.click(screen.getByRole("switch", { name: "SPA fallback" }));
    await user.click(screen.getByRole("button", { name: "Save production access" }));

    expect(onSave).toHaveBeenCalledWith({
      spaFallback: false,
      cachePolicy: "standard",
    });
  });

  it("previews aggressive cache warnings before saving", async () => {
    const user = userEvent.setup();

    renderSettings({
      project: makeProject({
        cachePolicy: "aggressive",
      }),
    });

    expect(screen.getByText("public, max-age=31536000, immutable")).toBeInTheDocument();
    expect(screen.getByText("Aggressive cache uses immutable releases")).toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "SPA fallback" }));

    expect(
      screen.getByText("Unknown routes return 404 unless the artifact contains the requested file."),
    ).toBeInTheDocument();
  });

  it("keeps unsupported production fields out of the Rust API form", () => {
    renderSettings();
    expect(screen.queryByLabelText("Custom domains")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete project/i })).not.toBeInTheDocument();
  });
});
