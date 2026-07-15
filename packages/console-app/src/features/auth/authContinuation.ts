export const INVITATION_ACCEPT_PATH = "/invitations/accept";

type AuthContinuation = typeof INVITATION_ACCEPT_PATH;

let continuation: AuthContinuation | null = null;

/** Remember only a compile-time-approved internal destination, never credentials. */
export function setInvitationAuthContinuation() {
  continuation = INVITATION_ACCEPT_PATH;
}

export function getAuthContinuation(): AuthContinuation | null {
  return continuation;
}

export function clearAuthContinuation() {
  continuation = null;
}

export function resetAuthContinuationForTests() {
  continuation = null;
}
