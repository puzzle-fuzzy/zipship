import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AppHeader } from "../src/features/layout/AppHeader";
import { useSettingsStore } from "../src/stores/settingsStore";

beforeEach(() => {
  useSettingsStore.setState({ language: "en" });
});

const user = { id: "u1", name: "Ada Lovelace", email: "ada@example.com" };

describe("AppHeader", () => {
  it("keeps the selected organization explicit and switchable", async () => {
    const userEventDriver = userEvent.setup();
    const onOrganizationChange = vi.fn();
    render(
      <MemoryRouter>
        <AppHeader
          user={user}
          organizations={[
            { id: "org-1", name: "Acme", slug: "acme", role: "owner" },
            { id: "org-2", name: "Orbit", slug: "orbit", role: "developer" },
          ]}
          selectedOrganizationId="org-2"
          organizationsLoading={false}
          onOrganizationChange={onOrganizationChange}
          onLogout={() => {}}
          onOpenSettings={() => {}}
          onOpenProfile={() => {}}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: /ZipShip/ })).toHaveAttribute("href", "/app/projects");
    expect(screen.getByRole("combobox", { name: "Organization" })).toHaveValue("org-2");
    expect(screen.getByRole("option", { name: "Acme" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Orbit" })).toBeInTheDocument();

    await userEventDriver.selectOptions(
      screen.getByRole("combobox", { name: "Organization" }),
      "org-1",
    );
    expect(onOrganizationChange).toHaveBeenCalledWith("org-1");
    expect(screen.getByText("AL")).toBeInTheDocument();
    expect(screen.queryByText("Logs")).not.toBeInTheDocument();
    expect(screen.queryByText("Storage")).not.toBeInTheDocument();
  });

  it("shows an honest disabled state when no organization is available", () => {
    render(
      <MemoryRouter>
        <AppHeader
          user={user}
          organizations={[]}
          selectedOrganizationId={null}
          organizationsLoading={false}
          onOrganizationChange={() => {}}
          onLogout={() => {}}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("combobox", { name: "Organization" })).toBeDisabled();
    expect(screen.getByRole("option", { name: "No organizations" })).toBeInTheDocument();
  });
});
