import { resolvePrincipal, type ApiTokenLookup } from "../../lib/auth";
import type { ApiTokenHeaders } from "./model";

export interface ApiTokenRecord {
  id: string;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export interface ApiTokensRepository extends ApiTokenLookup {
  createApiToken(input: {
    userId: string;
    name: string;
    tokenHash: string;
  }): Promise<{ id: string; name: string; createdAt: Date }>;
  listApiTokensForUser(userId: string): Promise<ApiTokenRecord[]>;
  revokeApiToken(input: { userId: string; tokenId: string }): Promise<boolean>;
}

export interface ApiTokensServiceOptions {
  sessionRepository: Parameters<typeof resolvePrincipal>[0]["sessionRepository"];
  apiTokensRepository: ApiTokensRepository;
  hashRefreshToken: (token: string) => Promise<string>;
  hashToken: (token: string) => Promise<string>;
  randomToken: () => string;
  now: () => Date;
}

export class ApiTokensServiceError {
  constructor(public readonly code: "UNAUTHORIZED" | "NOT_FOUND") {}
}

/** Generate the user-facing plaintext token (prefixed for easy identification). */
function generateToken(random: () => string): string {
  return `zship_${random().replace(/-/g, "")}`;
}

export class ApiTokensService {
  constructor(private readonly options: ApiTokensServiceOptions) {}

  private async resolvePrincipal(headers: ApiTokenHeaders) {
    return resolvePrincipal({
      authorization: headers.authorization,
      sessionRepository: this.options.sessionRepository,
      apiTokensRepository: this.options.apiTokensRepository,
      hashRefreshToken: this.options.hashRefreshToken,
      hashToken: this.options.hashToken,
      now: this.options.now,
    });
  }

  async create(
    headers: ApiTokenHeaders,
    input: { name: string },
  ): Promise<{ id: string; name: string; token: string; createdAt: string } | ApiTokensServiceError> {
    const principal = await this.resolvePrincipal(headers);
    if (!principal) return new ApiTokensServiceError("UNAUTHORIZED");

    const token = generateToken(this.options.randomToken);
    const tokenHash = await this.options.hashToken(token);
    const created = await this.options.apiTokensRepository.createApiToken({
      userId: principal.user.id,
      name: input.name,
      tokenHash,
    });
    return {
      id: created.id,
      name: created.name,
      token,
      createdAt: created.createdAt.toISOString(),
    };
  }

  async list(
    headers: ApiTokenHeaders,
  ): Promise<{ tokens: Array<{ id: string; name: string; createdAt: string; lastUsedAt: string | null }> } | ApiTokensServiceError> {
    const principal = await this.resolvePrincipal(headers);
    if (!principal) return new ApiTokensServiceError("UNAUTHORIZED");

    const tokens = await this.options.apiTokensRepository.listApiTokensForUser(principal.user.id);
    return {
      tokens: tokens.map((tk) => ({
        id: tk.id,
        name: tk.name,
        createdAt: tk.createdAt.toISOString(),
        lastUsedAt: tk.lastUsedAt ? tk.lastUsedAt.toISOString() : null,
      })),
    };
  }

  async revoke(
    headers: ApiTokenHeaders,
    tokenId: string,
  ): Promise<{ ok: true } | ApiTokensServiceError> {
    const principal = await this.resolvePrincipal(headers);
    if (!principal) return new ApiTokensServiceError("UNAUTHORIZED");

    const found = await this.options.apiTokensRepository.revokeApiToken({
      userId: principal.user.id,
      tokenId,
    });
    if (!found) return new ApiTokensServiceError("NOT_FOUND");
    return { ok: true };
  }
}
