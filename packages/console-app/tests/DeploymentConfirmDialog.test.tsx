import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeploymentConfirmDialog } from "../src/features/project-detail/DeploymentConfirmDialog";
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
    previewUrl: "/_sites/demo/release-1/",
    fullHash: "full",
    status: "ready",
    fileCount: 3,
    totalSize: 4096,
    manifest: {},
    detectResult: {
      level: "warning",
      items: [{ level: "warning", code: "ROOT_ASSET_PATH_DETECTED" }],
      insights: {
        seo: {
          score: 67,
          checks: [{ code: "SEO_DESCRIPTION_MISSING", status: "warning" }],
        },
      },
      runtime: {
        level: "warning",
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
    archivedAt: null,
    ...overrides,
  };
}

describe("DeploymentConfirmDialog", () => {
  it("shows release context, quality gate, and submits the note", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onMessageChange = vi.fn();

    render(
      <DeploymentConfirmDialog
        intent={{ action: "publish", release: makeRelease() }}
        activeRelease={null}
        loading={false}
        message="Ship homepage"
        onMessageChange={onMessageChange}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByRole("heading", { name: "Publish this version?" })).toBeInTheDocument();
    expect(screen.getByText("v1 (abcdef123456)")).toBeInTheDocument();
    expect(screen.getByText("Pre-publish quality check")).toBeInTheDocument();
    expect(screen.getByText("3 warnings were found. Review them before changing production traffic.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Ship homepage")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("What changed in this release?"), {
      target: { value: "Final polish" },
    });
    expect(onMessageChange).toHaveBeenCalledWith("Final polish");

    const confirmButtons = screen.getAllByRole("button", { name: "Publish" });
    await user.click(confirmButtons[confirmButtons.length - 1]!);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls cancel when the dialog is cancelled", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(
      <DeploymentConfirmDialog
        intent={{ action: "rollback", release: makeRelease() }}
        activeRelease={makeRelease({ id: "release-2", versionNumber: 2 })}
        loading={false}
        message=""
        onMessageChange={() => {}}
        onCancel={onCancel}
        onConfirm={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("requires explicit risk acceptance before publishing failed checks", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <DeploymentConfirmDialog
        intent={{
          action: "publish",
          release: makeRelease({
            detectResult: {
              level: "failed",
              items: [{ level: "failed", code: "MISSING_INDEX_HTML" }],
            },
          }),
        }}
        activeRelease={null}
        loading={false}
        message=""
        onMessageChange={() => {}}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByText("Acknowledge failed checks")).toBeInTheDocument();
    const confirmButtons = screen.getAllByRole("button", { name: "Publish" });
    const confirmButton = confirmButtons[confirmButtons.length - 1]!;
    expect(confirmButton).toBeDisabled();

    await user.click(screen.getByRole("checkbox", {
      name: "I understand the failed checks and want to publish anyway",
    }));
    expect(confirmButton).toBeEnabled();

    await user.click(confirmButton);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("treats a missing quality report as unverified and requires acknowledgement", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <DeploymentConfirmDialog
        intent={{
          action: "publish",
          release: makeRelease({
            detectResult: {
              entryPoint: "index.html",
              manifestVersion: 1,
            },
          }),
        }}
        activeRelease={null}
        loading={false}
        message=""
        onMessageChange={() => {}}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );

    expect(
      screen.getByText("Automated quality checks did not run for this release. Review the preview before publishing."),
    ).toBeInTheDocument();
    expect(screen.queryByText("No blocking issues were detected for this release.")).not.toBeInTheDocument();
    expect(screen.getAllByText("Not evaluated")).toHaveLength(3);

    const confirmButtons = screen.getAllByRole("button", { name: "Publish" });
    const confirmButton = confirmButtons[confirmButtons.length - 1]!;
    expect(confirmButton).toBeDisabled();

    await user.click(screen.getByRole("checkbox", {
      name: "I reviewed the preview and understand that ZipShip has not verified this release",
    }));
    expect(confirmButton).toBeEnabled();

    await user.click(confirmButton);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not require failed-check acceptance when rolling back", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <DeploymentConfirmDialog
        intent={{
          action: "rollback",
          release: makeRelease({
            detectResult: {
              level: "failed",
              items: [{ level: "failed", code: "MISSING_INDEX_HTML" }],
            },
          }),
        }}
        activeRelease={makeRelease({ id: "release-2", versionNumber: 2 })}
        loading={false}
        message=""
        onMessageChange={() => {}}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.queryByText("Acknowledge failed checks")).not.toBeInTheDocument();
    const confirmButtons = screen.getAllByRole("button", { name: "Roll back" });
    await user.click(confirmButtons[confirmButtons.length - 1]!);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
