import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AppHeader } from "../src/features/layout/AppHeader";
import { useSettingsStore } from "../src/stores/settingsStore";

beforeEach(() => {
  useSettingsStore.setState({ language: "en" });
});

const user = { id: "u1", name: "Ada Lovelace", email: "ada@example.com" };

describe("AppHeader", () => {
  it("keeps the shell focused on projects and account controls", () => {
    render(
      <MemoryRouter>
        <AppHeader
          user={user}
          onLogout={() => {}}
          onOpenSettings={() => {}}
          onOpenProfile={() => {}}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: /ZipShip/ })).toHaveAttribute("href", "/app/projects");
    expect(screen.getByText("AL")).toBeInTheDocument();
    expect(screen.queryByText("Logs")).not.toBeInTheDocument();
    expect(screen.queryByText("Storage")).not.toBeInTheDocument();
  });
});
