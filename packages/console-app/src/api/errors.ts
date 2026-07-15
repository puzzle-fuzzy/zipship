export interface OpenApiFailure {
  error?: unknown;
  response?: Response;
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export function getApiErrorCode(
  result: OpenApiFailure | null | undefined,
): string | undefined {
  const body = result?.error as { code?: unknown } | undefined;
  return typeof body?.code === "string" ? body.code : undefined;
}

export function mapApiError(
  result: OpenApiFailure,
  options: { codes: Record<string, string>; fallback: string },
): Error {
  const code = getApiErrorCode(result);
  return new ApiClientError(
    (code && options.codes[code]) || options.fallback,
    code,
  );
}

export function getThrownApiErrorCode(error: unknown): string | undefined {
  return error instanceof ApiClientError ? error.code : undefined;
}

export const API_ERROR_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "Session expired, please sign in again",
  INVALID_CSRF_TOKEN: "This page is stale, refresh and try again",
  FORBIDDEN: "You don't have permission to do that",
  INVALID_JSON: "Please check your input and try again",
  NOT_FOUND: "Not found",

  INVALID_CREDENTIALS: "Invalid email or password",
  ACCOUNT_DISABLED: "This account is disabled",
  DUPLICATE_EMAIL: "An account with this email already exists",
  INVALID_EMAIL: "Enter a valid email",
  INVALID_DISPLAY_NAME: "Enter a valid display name",
  INVALID_PASSWORD: "Password must be between 12 and 128 characters",
  INVALID_PASSWORD_RESET_TOKEN: "This reset link is invalid or has expired",
  ANONYMOUS_RATE_LIMITED: "Too many attempts, wait before trying again",

  DUPLICATE_PROJECT_SLUG: "A project with this slug already exists",
  PROJECT_NOT_FOUND: "Project not found",
  RELEASE_NOT_FOUND: "Release not found",

  ALREADY_MEMBER: "This user is already a member",
  INVITATION_ALREADY_PENDING: "An invitation is already pending for this email",
  LAST_OWNER: "Can't remove or demote the last owner",
} as const;
