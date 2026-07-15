import { beforeEach, describe, expect, it } from "vitest";
import {
  consumeInvitationToken,
  resetInvitationTokenForTests,
} from "../src/features/invitations/invitationToken";

beforeEach(() => {
  resetInvitationTokenForTests();
  window.history.replaceState({}, "", "/invitations/accept");
  sessionStorage.clear();
  localStorage.clear();
});

describe("invitation fragment credential", () => {
  it("consumes the fragment and immediately scrubs browser history", () => {
    window.history.replaceState(
      {},
      "",
      "/invitations/accept?source=email#token=secret%20token",
    );

    expect(consumeInvitationToken()).toBe("secret token");
    expect(window.location.pathname).toBe("/invitations/accept");
    expect(window.location.search).toBe("?source=email");
    expect(window.location.hash).toBe("");
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it("holds the token only in document memory across a Strict Mode remount", () => {
    window.history.replaceState(
      {},
      "",
      "/invitations/accept#token=secret-token",
    );
    expect(consumeInvitationToken()).toBe("secret-token");
    expect(consumeInvitationToken()).toBe("secret-token");
  });

  it("never accepts a credential from the query string", () => {
    window.history.replaceState(
      {},
      "",
      "/invitations/accept?token=query-secret",
    );
    expect(consumeInvitationToken()).toBeNull();
    expect(window.location.search).toBe("");
  });

  it("fails closed when the fragment credential is absent", () => {
    expect(consumeInvitationToken()).toBeNull();
  });
});
