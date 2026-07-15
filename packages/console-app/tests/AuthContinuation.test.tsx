import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getAuthContinuation,
  resetAuthContinuationForTests,
  setInvitationAuthContinuation,
} from "../src/features/auth/authContinuation";
import { PublicOnly } from "../src/features/auth/AuthRouteGuards";
import { useAuthStore } from "../src/stores/authStore";

beforeEach(() => {
  resetAuthContinuationForTests();
  useAuthStore.setState({ status: "login", user: null });
});

describe("in-memory authentication continuation", () => {
  it("stores only the fixed invitation destination", () => {
    setInvitationAuthContinuation();
    expect(getAuthContinuation()).toBe("/invitations/accept");
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it("returns an authenticated login round trip to invitation acceptance", () => {
    setInvitationAuthContinuation();
    useAuthStore.setState({
      status: "authenticated",
      user: { id: "u1", name: "Ada", email: "ada@example.com" },
    });

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route
            path="/login"
            element={
              <PublicOnly>
                <div>Login</div>
              </PublicOnly>
            }
          />
          <Route
            path="/invitations/accept"
            element={<div>Invitation resumed</div>}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Invitation resumed")).toBeInTheDocument();
  });
});
