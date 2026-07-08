import { beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";
import { render, screen } from "@testing-library/react";
import { AppSidebar } from "../src/features/layout/AppSidebar";
import { SidebarProvider } from "../src/components/ui/sidebar";
import { useSettingsStore } from "../src/stores/settingsStore";

/**
 * The sidebar is now a pure nav menu. We pin that all three items render, that
 * the current route's item is marked active (NavLink aria-current), and that a
 * child route still marks its parent active (project detail → Projects).
 */

beforeEach(() => {
  useSettingsStore.setState({ language: "en" });
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

describe("AppSidebar", () => {
  it("renders the brand and all three nav items", () => {
    renderAt("/app/projects");
    expect(screen.getByText("ZipShip")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Projects/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Logs/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Storage/ })).toBeInTheDocument();
  });

  it("marks the current top-level item active", () => {
    renderAt("/app/logs");
    const logs = screen.getByRole("link", { name: /Logs/ });
    const projects = screen.getByRole("link", { name: /Projects/ });
    expect(logs).toHaveAttribute("aria-current", "page");
    expect(projects).not.toHaveAttribute("aria-current", "page");
  });

  it("keeps Projects active on a project-detail child route", () => {
    renderAt("/app/projects/abc-123");
    const projects = screen.getByRole("link", { name: /Projects/ });
    expect(projects).toHaveAttribute("aria-current", "page");
  });
});
