import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectMembersTab } from "../src/features/project-detail/ProjectMembersTab";
import type { Invitation, Member } from "../src/stores/membersStore";
import { useSettingsStore } from "../src/stores/settingsStore";

function makeMember(overrides: Partial<Member> = {}): Member {
  return {
    id: "m1",
    userId: "u1",
    name: "Ada",
    email: "a@x.com",
    role: "developer",
    joinedAt: "2026-07-15T00:00:00Z",
    ...overrides,
  };
}

function makeInvitation(overrides: Partial<Invitation> = {}): Invitation {
  return {
    id: "invite-1",
    organizationId: "org-1",
    email: "new@example.com",
    role: "developer",
    state: "pending",
    invitedBy: "u1",
    createdAt: "2026-07-15T00:00:00Z",
    expiresAt: "2026-07-22T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  useSettingsStore.setState({ language: "en" });
});

function renderTab(
  overrides: Partial<{
    members: Member[];
    invitations: Invitation[];
    canManage: boolean;
    currentUserId: string | null;
    currentUserRole: string | null;
    onRemove: (member: Member) => Promise<void>;
    onChangeRole: (member: Member, role: string) => Promise<void>;
    onRevokeInvitation: (invitation: Invitation) => Promise<void>;
  }> = {},
) {
  const onRemove = overrides.onRemove ?? vi.fn().mockResolvedValue(undefined);
  const onChangeRole =
    overrides.onChangeRole ?? vi.fn().mockResolvedValue(undefined);
  const onRevokeInvitation =
    overrides.onRevokeInvitation ?? vi.fn().mockResolvedValue(undefined);
  return render(
    <ProjectMembersTab
      members={overrides.members ?? [makeMember()]}
      invitations={overrides.invitations ?? []}
      loading={false}
      invitationsLoading={false}
      invitationsError={null}
      canManage={overrides.canManage ?? true}
      currentUserId={overrides.currentUserId ?? "other"}
      currentUserRole={overrides.currentUserRole ?? "owner"}
      onInviteClick={() => {}}
      onRetryInvitations={() => {}}
      onChangeRole={onChangeRole}
      onRemove={onRemove}
      onRevokeInvitation={onRevokeInvitation}
    />,
  );
}

describe("ProjectMembersTab", () => {
  it("marks your own row and disables your remove button", () => {
    renderTab({ currentUserId: "u1" });
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove")).toBeDisabled();
  });

  it("disables remove for the last owner", () => {
    renderTab({ members: [makeMember({ role: "owner" })] });
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove")).toBeDisabled();
  });

  it("hides management controls and pending invitations from viewers", () => {
    renderTab({ canManage: false });
    expect(screen.queryByRole("button", { name: "Invite" })).not.toBeInTheDocument();
    expect(screen.queryByText("Pending invitations")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Remove")).toBeDisabled();
  });

  it("removes a member after the accessible confirmation", async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined);
    const member = makeMember();
    const user = userEvent.setup();
    renderTab({ members: [member], onRemove });

    await user.click(screen.getByLabelText("Remove"));
    expect(
      screen.getByRole("alertdialog", { name: "Remove Ada from this organization?" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(onRemove).toHaveBeenCalledWith(member));
  });

  it("does not remove when the confirmation is cancelled", async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderTab({ onRemove });

    await user.click(screen.getByLabelText("Remove"));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("lists and revokes pending invitations", async () => {
    const invitation = makeInvitation();
    const onRevokeInvitation = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderTab({ invitations: [invitation], onRevokeInvitation });

    expect(screen.getByText("new@example.com")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Revoke invitation"));
    expect(
      screen.getByRole("alertdialog", {
        name: "Revoke the invitation for new@example.com?",
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(onRevokeInvitation).toHaveBeenCalledWith(invitation),
    );
  });

  it("prevents an admin from revoking an owner invitation", () => {
    renderTab({
      invitations: [makeInvitation({ role: "owner" })],
      currentUserRole: "admin",
    });
    expect(screen.getByLabelText("Revoke invitation")).toBeDisabled();
  });
});
