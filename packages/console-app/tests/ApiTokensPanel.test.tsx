import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "../src/stores/settingsStore";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
}));

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../src/features/settings/apiTokens", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/features/settings/apiTokens")
  >();
  return {
    ...actual,
    listApiTokens: api.list,
    createApiToken: api.create,
    revokeApiToken: api.revoke,
  };
});

vi.mock("sonner", () => ({ toast }));

const { ApiTokensPanel } = await import(
  "../src/features/settings/ApiTokensPanel"
);

const activeToken = {
  id: "token-1",
  name: "Production deploy",
  displayPrefix: "zps_12345678",
  scopes: ["projects:read", "deployments:write"] as const,
  state: "active" as const,
  expiresAt: "2026-08-14T00:00:00Z",
  lastUsedAt: null,
  revokedAt: null,
  createdAt: "2026-07-15T00:00:00Z",
};

beforeEach(() => {
  useSettingsStore.setState({ language: "en" });
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  api.list.mockReset().mockResolvedValue([]);
  api.create.mockReset();
  api.revoke.mockReset().mockResolvedValue(undefined);
  toast.success.mockReset();
  toast.error.mockReset();
});

describe("ApiTokensPanel", () => {
  it("lists token metadata, states, scopes, and only active revoke actions", async () => {
    api.list.mockResolvedValueOnce([
      activeToken,
      {
        ...activeToken,
        id: "token-2",
        name: "Old preview reader",
        state: "expired",
        scopes: ["releases:read"],
      },
    ]);

    render(<ApiTokensPanel />);

    expect(await screen.findByText("Production deploy")).toBeInTheDocument();
    expect(screen.getByText("Old preview reader")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Expired")).toBeInTheDocument();
    expect(screen.getByText("projects:read")).toBeInTheDocument();
    expect(screen.getAllByText("Never")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Revoke token" })).toHaveLength(1);
  });

  it("keeps the one-time secret inside the creation dialog and clears it on close", async () => {
    const secret = "zps_one-time-secret-that-must-not-persist";
    api.create.mockResolvedValueOnce({ apiToken: activeToken, secret });
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    render(<ApiTokensPanel />);

    await screen.findByText("No API tokens");
    await user.click(screen.getAllByRole("button", { name: "Create token" })[0]);
    const dialog = screen.getByRole("dialog", { name: "Create token" });

    await user.click(within(dialog).getByRole("button", { name: "Create token" }));
    expect(within(dialog).getByText("Enter a token name.")).toBeInTheDocument();
    expect(within(dialog).getByText("Select at least one scope.")).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText("Token name"), "Production deploy");
    await user.click(within(dialog).getByLabelText("Read projects"));
    await user.click(within(dialog).getByLabelText("Upload releases"));
    await user.click(within(dialog).getByRole("button", { name: "Create token" }));

    expect(api.create).toHaveBeenCalledWith({
      name: "Production deploy",
      scopes: ["projects:read", "uploads:write"],
      expiresInDays: 30,
    });
    expect(await screen.findByLabelText("New API token")).toHaveTextContent(secret);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(JSON.stringify(useSettingsStore.getState())).not.toContain(secret);

    await user.click(screen.getByRole("button", { name: "Copy token" }));
    expect(writeText).toHaveBeenCalledWith(secret);
    expect(screen.getByRole("button", { name: "Token copied" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText(secret)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create token" }));
    expect(screen.queryByText(secret)).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Create token" })).toBeInTheDocument();
  });

  it("revokes an active token only after accessible confirmation", async () => {
    api.list.mockResolvedValueOnce([activeToken]);
    const user = userEvent.setup();
    render(<ApiTokensPanel />);

    await user.click(await screen.findByRole("button", { name: "Revoke token" }));
    const confirmation = screen.getByRole("alertdialog", {
      name: "Revoke Production deploy?",
    });
    expect(api.revoke).not.toHaveBeenCalled();
    await user.click(within(confirmation).getByRole("button", { name: "Revoke token" }));

    await waitFor(() => expect(api.revoke).toHaveBeenCalledWith("token-1"));
    expect(await screen.findByText("Revoked")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revoke token" })).not.toBeInTheDocument();
  });

  it("shows a stable load error and retries in place", async () => {
    api.list
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce([activeToken]);
    const user = userEvent.setup();
    render(<ApiTokensPanel />);

    expect(
      await screen.findByText("API tokens could not be loaded"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Production deploy")).toBeInTheDocument();
    expect(api.list).toHaveBeenCalledTimes(2);
  });
});
