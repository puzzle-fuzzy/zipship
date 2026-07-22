import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../src/api/errors";
import {
  getAuthContinuation,
  resetAuthContinuationForTests,
} from "../src/features/auth/authContinuation";
import { resetInvitationTokenForTests } from "../src/features/invitations/invitationToken";
import { InvitationAcceptPage } from "../src/pages/InvitationAcceptPage";
import { useAuthStore } from "../src/stores/authStore";
import { useMembersStore } from "../src/stores/membersStore";
import { useOrganizationsStore } from "../src/stores/organizationsStore";
import { useSettingsStore } from "../src/stores/settingsStore";

function renderPage() {
  return render(
    <MemoryRouter>
      <InvitationAcceptPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useSettingsStore.setState({ language: "en" });
  useAuthStore.setState({ status: "login", user: null });
  useMembersStore.setState({
    acceptInvitation: vi.fn(),
  });
  useOrganizationsStore.getState().resetOrganizations();
  resetInvitationTokenForTests();
  resetAuthContinuationForTests();
  window.history.replaceState({}, "", "/invitations/accept");
});

describe("InvitationAcceptPage", () => {
  it("fails closed when the invitation credential is missing", () => {
    renderPage();
    expect(screen.getByText("Invitation link required")).toBeInTheDocument();
    expect(getAuthContinuation()).toBeNull();
  });

  it("scrubs the token and preserves a memory-only login continuation", async () => {
    window.history.replaceState(
      {},
      "",
      "/invitations/accept#token=secret-token",
    );
    renderPage();

    expect(window.location.hash).toBe("");
    expect(
      screen.getByRole("link", { name: "Continue to sign in" }),
    ).toHaveAttribute("href", "/login");
    await waitFor(() =>
      expect(getAuthContinuation()).toBe("/invitations/accept"),
    );
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it("accepts the in-memory token and treats a safe replay as success", async () => {
    const acceptInvitation = vi.fn().mockResolvedValue({
      invitationId: "invite-1",
      organizationId: "org-1",
      userId: "u1",
      role: "developer",
      replayed: true,
    });
    useMembersStore.setState({ acceptInvitation });
    useAuthStore.setState({
      status: "authenticated",
      user: { id: "u1", name: "Ada", email: "ada@example.com" },
    });
    window.history.replaceState(
      {},
      "",
      "/invitations/accept#token=secret-token",
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Accept invitation" }));
    await waitFor(() =>
      expect(acceptInvitation).toHaveBeenCalledWith("secret-token"),
    );
    expect(screen.getByText("Invitation accepted")).toBeInTheDocument();
    expect(screen.getByText("You joined the organization as Developer.")).toBeInTheDocument();
    expect(useOrganizationsStore.getState().selectedOrganizationId).toBe("org-1");
    expect(localStorage.getItem("zipship_organization_id")).toBe("org-1");
    expect(getAuthContinuation()).toBeNull();
  });

  it("collapses expired and revoked tokens into the same unavailable state", async () => {
    const acceptInvitation = vi
      .fn()
      .mockRejectedValue(new ApiClientError("expired", "INVITATION_EXPIRED"));
    useMembersStore.setState({ acceptInvitation });
    useAuthStore.setState({
      status: "authenticated",
      user: { id: "u1", name: "Ada", email: "ada@example.com" },
    });
    window.history.replaceState(
      {},
      "",
      "/invitations/accept#token=secret-token",
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Accept invitation" }));
    expect(await screen.findByText("Invitation unavailable")).toBeInTheDocument();
    expect(screen.getByText(/invalid, expired, revoked/)).toBeInTheDocument();
  });

  it("handles a wrong account without revealing the invited email", async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    const acceptInvitation = vi.fn().mockRejectedValue(
      new ApiClientError("wrong recipient", "INVITATION_WRONG_RECIPIENT"),
    );
    useMembersStore.setState({ acceptInvitation });
    useAuthStore.setState({
      status: "authenticated",
      user: { id: "u1", name: "Ada", email: "ada@example.com" },
      logout,
    });
    window.history.replaceState(
      {},
      "",
      "/invitations/accept#token=secret-token",
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Accept invitation" }));
    expect(await screen.findByText("Use the invited account")).toBeInTheDocument();
    expect(screen.queryByText("ada@example.com")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use another account" }));
    await waitFor(() => expect(logout).toHaveBeenCalledOnce());
    expect(getAuthContinuation()).toBe("/invitations/accept");
  });
});
