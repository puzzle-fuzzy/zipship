/**
 * Centralized API error mapping.
 *
 * The backend returns stable `code` strings (e.g. `DUPLICATE_EMAIL`,
 * `FORBIDDEN`). Each store used to keep its own `code → message` table and
 * repeat the same extract-code-or-fallback dance. {@link mapApiError} does that
 * once; call sites pass their domain-specific code map.
 */

export interface TreatyError {
  status: number;
  error?: { value: unknown };
}

/** Pull the stable `code` field out of a treaty error body, if present. */
export function getApiErrorCode(res: TreatyError | null | undefined): string | undefined {
  const value = res?.error?.value as { code?: string } | undefined;
  return value?.code;
}

/**
 * Convert a treaty error response into a user-facing `Error`. Picks the mapped
 * message for a known code, otherwise `fallback`.
 */
export function mapApiError(
  res: TreatyError,
  options: { codes: Record<string, string>; fallback: string },
): Error {
  const code = getApiErrorCode(res);
  return new Error((code && options.codes[code]) || options.fallback);
}

/**
 * The single shared table of API error codes → default messages. Components can
 * use these directly, or override per-call via {@link mapApiError}'s `codes`.
 */
export const API_ERROR_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: "Session expired — please sign in again",
  FORBIDDEN: "You don't have permission to do that",
  VALIDATION_ERROR: "Validation failed — check your input",
  NOT_FOUND: "Not found",

  // auth
  INVALID_CREDENTIALS: "Invalid email or password",
  DUPLICATE_EMAIL: "An account with this email already exists",
  INVALID_INPUT: "Please check your input and try again",

  // projects / releases
  DUPLICATE_PROJECT_SLUG: "A project with this slug already exists",
  PROJECT_NOT_FOUND: "Project not found",
  RELEASE_NOT_FOUND: "Release not found",

  // members / invitations
  USER_NOT_FOUND: "No user found with this email",
  ALREADY_MEMBER: "This user is already a member",
  INVITATION_PENDING: "An invitation is already pending for this email",
} as const;
