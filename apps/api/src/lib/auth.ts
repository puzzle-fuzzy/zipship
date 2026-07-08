/**
 * Shared authentication helpers for the control-plane services.
 *
 * Every authenticated module used to redefine {@link parseBearerToken} locally
 * (8 identical copies). Centralize it here so behavior can't drift between
 * modules.
 */

/** Shape returned by {@link SessionLookup.findSessionByRefreshTokenHash}. */
export interface ResolvedSession {
  user: { id: string; name: string; email: string };
  session: { id: string; clientType: "web" | "desktop"; expiresAt: string };
}

/** Minimal repository surface needed to look up a session. */
export interface SessionLookup {
  findSessionByRefreshTokenHash(
    refreshTokenHash: string,
    now: Date,
  ): Promise<ResolvedSession | null>;
}

/**
 * Extract the opaque token from an `Authorization: Bearer <token>` header.
 * Case-insensitive on the scheme (`bearer` / `Bearer`). Returns `null` when the
 * header is missing or malformed — callers decide which domain error that maps
 * to.
 */
export function parseBearerToken(
  authorization: string | undefined | null,
): string | null {
  if (!authorization) return null;
  const [scheme, token] = authorization.split(" ");
  if (scheme.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

/**
 * Resolve the current session from a request's Authorization header in one
 * step: parse → hash → look up. Returns `null` when the header is missing,
 * malformed, or the session is unknown/expired. Callers map `null` → their own
 * typed Unauthorized error.
 */
export async function resolveSession(args: {
  authorization: string | undefined | null;
  sessionRepository: SessionLookup;
  hashRefreshToken: (token: string) => Promise<string>;
  now: () => Date;
}): Promise<ResolvedSession | null> {
  const token = parseBearerToken(args.authorization);
  if (!token) return null;
  const hash = await args.hashRefreshToken(token);
  return args.sessionRepository.findSessionByRefreshTokenHash(hash, args.now());
}

/** Minimal repository surface needed to look up / touch an API token. */
export interface ApiTokenLookup {
  findActiveApiTokenByHash(
    tokenHash: string,
  ): Promise<{ userId: string; name: string; email: string } | null>;
  touchApiTokenLastUsed(tokenHash: string, now: Date): Promise<void>;
}

/** The authenticated actor, regardless of how they authenticated. */
export interface ResolvedPrincipal {
  user: { id: string; name: string; email: string };
  source: "session" | "api_token";
}

/**
 * Resolve the request principal — the single auth path for resource services.
 * Tries a refresh-token session first (browser console), then an API token
 * (CLI / CI). This is the centralized "auth guard": services call it instead of
 * each re-implementing bearer parsing + session lookup, and API tokens work
 * everywhere it's used without per-service changes. Returns `null` when the
 * credential is missing/invalid; callers map that to their Unauthorized error.
 */
export async function resolvePrincipal(args: {
  authorization: string | undefined | null;
  sessionRepository: SessionLookup;
  apiTokensRepository?: ApiTokenLookup;
  hashRefreshToken: (token: string) => Promise<string>;
  hashToken: (token: string) => Promise<string>;
  now: () => Date;
}): Promise<ResolvedPrincipal | null> {
  // 1. Refresh-token session (browser).
  const session = await resolveSession({
    authorization: args.authorization,
    sessionRepository: args.sessionRepository,
    hashRefreshToken: args.hashRefreshToken,
    now: args.now,
  });
  if (session) return { user: session.user, source: "session" };

  // 2. API token (CLI / CI).
  if (!args.apiTokensRepository) return null;
  const token = parseBearerToken(args.authorization);
  if (!token) return null;
  const hash = await args.hashToken(token);
  const apiToken = await args.apiTokensRepository.findActiveApiTokenByHash(hash);
  if (!apiToken) return null;
  await args.apiTokensRepository.touchApiTokenLastUsed(hash, args.now());
  return {
    user: { id: apiToken.userId, name: apiToken.name, email: apiToken.email },
    source: "api_token",
  };
}

/**
 * Wrap a session repository so a Bearer credential is accepted as EITHER a
 * refresh-token session (browser) OR an API token (CLI/CI). Both use the same
 * SHA-256 hash, so the one hash computed by the caller is tried against both
 * stores. Resource modules receive this composite as their `sessionRepository`,
 * which means API tokens work on every resource endpoint with zero per-service
 * changes. Auth-only endpoints (me / logout / password-reset) keep the raw
 * session repository.
 */
export function createSessionOrApiTokenLookup(
  sessionRepository: SessionLookup,
  apiTokensRepository: ApiTokenLookup,
): SessionLookup {
  return {
    async findSessionByRefreshTokenHash(refreshTokenHash, now) {
      const session = await sessionRepository.findSessionByRefreshTokenHash(refreshTokenHash, now);
      if (session) return session;

      const apiToken = await apiTokensRepository.findActiveApiTokenByHash(refreshTokenHash);
      if (!apiToken) return null;
      await apiTokensRepository.touchApiTokenLastUsed(refreshTokenHash, now);
      return {
        user: { id: apiToken.userId, name: apiToken.name, email: apiToken.email },
        session: {
          id: `api-token:${apiToken.userId}`,
          clientType: "web",
          // API tokens don't expire (they're revoked, not timed out); resource
          // services don't re-check this, but it must be future-dated so any
          // expiry guard treats the principal as live.
          expiresAt: new Date(now.getTime() + 60_000).toISOString(),
        },
      };
    },
  };
}

