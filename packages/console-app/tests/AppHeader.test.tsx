import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AppHeader } from "../src/features/layout/AppHeader";
import { useSettingsStore } from "../src/stores/settingsStore";

beforeEach(() => {
  useSettingsStore.setState({ language: "en" });
});

const user = { id: "u1", name: "Ada Lovelace", email: "ada@example.com" };

describe("AppHeader", () => {
  it("shows the New Project button on the left and the avatar on the right", () => {
    render(
      <AppHeader
        user={user}
        onNewProject={() => {}}
        onLogout={() => {}}
        onOpenSettings={() => {}}
        onOpenProfile={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /New Project/ })).toBeInTheDocument();
    // avatar trigger is a button containing the initials fallback
    expect(screen.getByText("AL")).toBeInTheDocument();
  });

  it("calls onNewProject when the New Project button is clicked", () => {
    const onNewProject = vi.fn();
    render(
      <AppHeader
        user={user}
        onNewProject={onNewProject}
        onLogout={() => {}}
        onOpenSettings={() => {}}
        onOpenProfile={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /New Project/ }));
    expect(onNewProject).toHaveBeenCalledOnce();
  });
});
