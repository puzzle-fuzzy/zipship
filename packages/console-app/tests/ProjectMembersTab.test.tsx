import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProjectMembersTab } from "../src/features/project-detail/ProjectMembersTab";
import type { Member } from "../src/stores/membersStore";
import { useSettingsStore } from "../src/stores/settingsStore";

function makeMember(over: Partial<Member> = {}): Member {
  return {
    id: "m1",
    userId: "u1",
    name: "Ada",
    email: "a@x.com",
    role: "developer",
    joinedAt: "",
    ...over,
  };
}

beforeEach(() => {
  useSettingsStore.setState({ language: "en" });
});
afterEach(() => vi.restoreAllMocks());

function renderTab(overrides: Partial<{
  members: Member[];
  canManage: boolean;
  currentUserId: string | null;
  onRemove: (m: Member) => Promise<void>;
  onChangeRole: (m: Member, r: string) => Promise<void>;
}> = {}) {
  const onRemove = overrides.onRemove ?? vi.fn().mockResolvedValue(undefined);
  const onChangeRole = overrides.onChangeRole ?? vi.fn().mockResolvedValue(undefined);
  return render(
    <ProjectMembersTab
      members={overrides.members ?? [makeMember()]}
      loading={false}
      canManage={overrides.canManage ?? true}
      currentUserId={overrides.currentUserId ?? "other"
      }
      onInviteClick={() => {}}
      onChangeRole={onChangeRole}
      onRemove={onRemove}
    />,
  );
}

describe("ProjectMembersTab", () => {
  it("marks your own row and disables your remove button", () => {
    renderTab({ members: [makeMember({ userId: "u1", role: "developer" })], currentUserId: "u1" });
    expect(screen.getByText(/Ada/)).toBeInTheDocument();
    expect(screen.getByText("(You)")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove")).toBeDisabled();
  });

  it("disables remove for the last owner", () => {
    renderTab({ members: [makeMember({ role: "owner" })], currentUserId: "other" });
    // owner renders as a static badge, remove is disabled
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove")).toBeDisabled();
  });

  it("disables remove when the viewer can't manage", () => {
    renderTab({ members: [makeMember({ role: "developer" })], canManage: false });
    expect(screen.getByLabelText("Remove")).toBeDisabled();
  });

  it("removes a member after confirming", async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const member = makeMember({ role: "developer" });
    renderTab({ members: [member], currentUserId: "other", onRemove });

    fireEvent.click(screen.getByLabelText("Remove"));

    expect(window.confirm).toHaveBeenCalledOnce();
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith(member));
  });

  it("does not remove when the confirm is cancelled", () => {
    const onRemove = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderTab({ members: [makeMember({ role: "developer" })], currentUserId: "other", onRemove });

    fireEvent.click(screen.getByLabelText("Remove"));
    expect(onRemove).not.toHaveBeenCalled();
  });
});
