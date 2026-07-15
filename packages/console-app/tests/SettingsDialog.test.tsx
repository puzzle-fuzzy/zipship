import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsDialog } from "../src/features/settings/SettingsDialog";
import { useSettingsStore } from "../src/stores/settingsStore";

const api = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock("../src/features/settings/apiTokens", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/features/settings/apiTokens")
  >();
  return { ...actual, listApiTokens: api.list };
});

beforeEach(() => {
  useSettingsStore.setState({ language: "en", theme: "day" });
  api.list.mockReset().mockResolvedValue([]);
});

describe("SettingsDialog", () => {
  it("uses accessible appearance and security navigation", async () => {
    const user = userEvent.setup();
    render(<SettingsHarness />);

    expect(screen.getByRole("navigation", { name: "Settings sections" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Appearance" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await user.click(screen.getByRole("button", { name: "Security" }));
    expect(await screen.findByRole("heading", { name: "API tokens" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Security" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it("returns to appearance after the settings dialog closes", async () => {
    const user = userEvent.setup();
    render(<SettingsHarness />);

    await user.click(screen.getByRole("button", { name: "Security" }));
    await screen.findByRole("heading", { name: "API tokens" });
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open settings" }));
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeInTheDocument();
  });
});

function SettingsHarness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open settings
      </button>
      <SettingsDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
