import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Database } from "lucide-react";
import { ComingSoon } from "../src/components/ComingSoon";
import { useSettingsStore } from "../src/stores/settingsStore";

beforeEach(() => {
  useSettingsStore.setState({ language: "en" });
});

describe("ComingSoon", () => {
  it("renders the title, description, and coming-soon badge", () => {
    render(
      <ComingSoon icon={Database} title="Storage" description="Storage management is coming soon." />,
    );
    expect(screen.getByRole("heading", { name: "Storage" })).toBeInTheDocument();
    expect(screen.getByText("Storage management is coming soon.")).toBeInTheDocument();
    expect(screen.getByText("Coming soon")).toBeInTheDocument();
  });
});
