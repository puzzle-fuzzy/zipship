import { parseBearerToken } from "../../lib/auth";
import { normalizeName, normalizeEmail } from "../../lib/normalize";
import { DuplicateEmailError, InvalidCredentialsError, InvalidRegistrationInputError, InvalidTokenError, ExpiredTokenError, UnauthorizedError } from "./model";
import type { AuthServiceError, LoginBody, LoginSuccess, LogoutHeaders, LogoutSuccess, MeHeaders, MeSuccess, PasswordResetRequestBody, PasswordResetConfirmBody, RegisterBody, RegisterSuccess, UpdateProfileBody } from "./model";
import { AuditService } from "../audit/service";
import type { AuditRepository } from "../audit/service";
import type { EmailService } from "../email/service";

const refreshTokenTtlMs = 1000 * 60 * 60 * 24 * 7;

export interface AuthRepository {
  emailExists(email: string): Promise<boolean>;
  findUserByEmail(email: string): Promise<{
    id: string;
    name: string;
    email: string;
    passwordHash: string;
  } | null>;
  createUserWithDefaultOrganization(input: {
    user: {
      name: string;
      email: string;
      passwordHash: string;
    };
    organization: {
      name: string;
      slug: string;
    };
    member: {
      role: "owner";
      status: "active";
    };
  }): Promise<Omit<RegisterSuccess, "session">>;
  createSession(input: {
    userId: string;
    clientType: "web" | "desktop";
    refreshTokenHash: string;
    expiresAt: Date;
  }): Promise<{
    id: string;
    clientType: "web" | "desktop";
    expiresAt: string;
  }>;
  invalidateSession(refreshTokenHash: string, now: Date): Promise<void>;
  findSessionByRefreshTokenHash(
    refreshTokenHash: string,
    now: Date,
  ): Promise<{
    user: {
      id: string;
      name: string;
      email: string;
    };
    session: {
      id: string;
      clientType: "web" | "desktop";
      expiresAt: string;
    };
  } | null>;
  findDefaultOrganizationForUser(userId: string): Promise<{
    id: string;
  } | null>;
  updateUser(userId: string, input: { name?: string }): Promise<void>;
  setUserPassword(userId: string, passwordHash: string): Promise<void>;
  createPasswordResetToken(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void>;
  findPasswordResetByTokenHash(tokenHash: string): Promise<{
    userId: string;
    expiresAt: Date;
    usedAt: Date | null;
  } | null>;
  markPasswordResetUsed(tokenHash: string, now: Date): Promise<void>;
}

export interface AuthServiceOptions {
  authRepository: AuthRepository;
  auditRepository: AuditRepository;
  hashPassword: (password: string) => Promise<string>;
  verifyPassword: (password: string, hash: string) => Promise<boolean>;
  createRefreshToken: () => string;
  hashRefreshToken: (token: string) => Promise<string>;
  now: () => Date;
  audit?: AuditService;
  emailService?: EmailService;
  /** Required to serve password-reset routes; optional so non-auth tests can omit it. */
  hashToken?: (token: string) => Promise<string>;
  randomToken?: () => string;
  appBaseUrl?: string;
}

export class AuthService {
  private readonly audit: AuditService;

  constructor(private readonly options: AuthServiceOptions) {
    this.audit =
      options.audit ??
      new AuditService({ repository: options.auditRepository, now: options.now });
  }

  async register(input: RegisterBody): Promise<RegisterSuccess | AuthServiceError> {
    const name = normalizeName(input.name);
    const email = normalizeEmail(input.email);

    if (!name || !email || input.password.length < 8) {
      return new InvalidRegistrationInputError();
    }

    if (await this.options.authRepository.emailExists(email)) {
      return new DuplicateEmailError();
    }

    const passwordHash = await this.options.hashPassword(input.password);

    const result = await this.options.authRepository.createUserWithDefaultOrganization({
      user: {
        name,
        email,
        passwordHash,
      },
      organization: {
        name,
        slug: createDefaultOrganizationSlug(email),
      },
      member: {
        role: "owner",
        status: "active",
      },
    });

    // Create a session immediately so the user is logged in after registration,
    // no separate login call needed on the frontend.
    const refreshToken = this.options.createRefreshToken();
    const refreshTokenHash = await this.options.hashRefreshToken(refreshToken);
    const expiresAt = new Date(this.options.now().getTime() + refreshTokenTtlMs);
    const session = await this.options.authRepository.createSession({
      userId: result.user.id,
      clientType: input.clientType ?? "web",
      refreshTokenHash,
      expiresAt,
    });

    return {
      ...result,
      session: {
        ...session,
        refreshToken,
      },
    };
  }

  async login(input: LoginBody): Promise<LoginSuccess | AuthServiceError> {
    const email = normalizeEmail(input.email);

    if (!email || input.password.length < 8) {
      return new InvalidCredentialsError();
    }

    const user = await this.options.authRepository.findUserByEmail(email);

    if (!user) {
      return new InvalidCredentialsError();
    }

    const verified = await this.options.verifyPassword(input.password, user.passwordHash);

    if (!verified) {
      return new InvalidCredentialsError();
    }

    const refreshToken = this.options.createRefreshToken();
    const refreshTokenHash = await this.options.hashRefreshToken(refreshToken);
    const expiresAt = new Date(this.options.now().getTime() + refreshTokenTtlMs);
    const session = await this.options.authRepository.createSession({
      userId: user.id,
      clientType: input.clientType ?? "web",
      refreshTokenHash,
      expiresAt,
    });
    const organization = await this.options.authRepository.findDefaultOrganizationForUser(user.id);

    if (organization && this.audit) {
      await this.audit.record({
        organizationId: organization.id,
        projectId: null,
        actorId: user.id,
        action: "auth.login_succeeded",
        targetType: "session",
        targetId: session.id,
        metadata: {
          clientType: session.clientType,
        },
        ipAddress: null,
        userAgent: null,
      });
    }

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      session: {
        ...session,
        refreshToken,
      },
    };
  }

  async me(input: MeHeaders): Promise<MeSuccess | AuthServiceError> {
    const refreshToken = parseBearerToken(input.authorization);

    if (!refreshToken) {
      return new UnauthorizedError();
    }

    const refreshTokenHash = await this.options.hashRefreshToken(refreshToken);
    const currentSession = await this.options.authRepository.findSessionByRefreshTokenHash(refreshTokenHash, this.options.now());

    if (!currentSession) {
      return new UnauthorizedError();
    }

    return currentSession;
  }

  async logout(input: LogoutHeaders): Promise<LogoutSuccess | AuthServiceError> {
    const refreshToken = parseBearerToken(input.authorization);

    if (!refreshToken) return new UnauthorizedError();

    const refreshTokenHash = await this.options.hashRefreshToken(refreshToken);
    const session = await this.options.authRepository.findSessionByRefreshTokenHash(refreshTokenHash, this.options.now());

    if (!session) return new UnauthorizedError();

    await this.options.authRepository.invalidateSession(refreshTokenHash, this.options.now());
    return { ok: true };
  }

  async updateProfile(
    headers: MeHeaders,
    body: UpdateProfileBody,
  ): Promise<MeSuccess | AuthServiceError> {
    const session = await this.resolveSession(headers);
    if (!session) return new UnauthorizedError();

    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) return new InvalidRegistrationInputError();
      await this.options.authRepository.updateUser(session.user.id, { name });
    }

    return session;
  }

  /**
   * Request a password reset. Always returns ok (even for unknown emails) so
   * the endpoint can't be used to enumerate accounts. When the email exists, a
   * single-use reset token is created and emailed.
   */
  async requestPasswordReset(input: PasswordResetRequestBody): Promise<{ ok: true }> {
    const email = normalizeEmail(input.email);
    if (!email) return { ok: true };

    const user = await this.options.authRepository.findUserByEmail(email);
    if (!user) return { ok: true };

    const token = this.options.randomToken!();
    const tokenHash = await this.options.hashToken!(token);
    const expiresAt = new Date(this.options.now().getTime() + 30 * 60 * 1000); // 30 minutes
    await this.options.authRepository.createPasswordResetToken({
      userId: user.id,
      tokenHash,
      expiresAt,
    });

    if (this.options.emailService) {
      await this.options.emailService.sendPasswordReset({
        to: email,
        resetUrl: `${(this.options.appBaseUrl ?? "").replace(/\/$/, "")}/reset-password/${token}`,
      });
    }
    return { ok: true };
  }

  /** Confirm a password reset: verify the token, set the new password, consume the token. */
  async confirmPasswordReset(
    input: PasswordResetConfirmBody,
  ): Promise<{ ok: true } | AuthServiceError> {
    const tokenHash = await this.options.hashToken!(input.token);
    const record = await this.options.authRepository.findPasswordResetByTokenHash(tokenHash);
    if (!record || record.usedAt !== null) return new InvalidTokenError();

    const now = this.options.now();
    if (record.expiresAt <= now) return new ExpiredTokenError();

    const passwordHash = await this.options.hashPassword(input.password);
    await this.options.authRepository.setUserPassword(record.userId, passwordHash);
    await this.options.authRepository.markPasswordResetUsed(tokenHash, now);
    return { ok: true };
  }

  private async resolveSession(headers: MeHeaders) {
    const token = parseBearerToken(headers.authorization);
    if (!token) return null;
    const hash = await this.options.hashRefreshToken(token);
    return this.options.authRepository.findSessionByRefreshTokenHash(hash, this.options.now());
  }
}

function createDefaultOrganizationSlug(email: string): string {
  let slug = email
    .split("@")[0]
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/_+/g, "-");

  // Edge case: email username that was entirely special characters
  // (e.g., "-@example.com" → "") results in an empty slug.
  // Fall back to the email's domain user part, or a hash.
  if (slug.length === 0) {
    slug = `user-${crypto.randomUUID().slice(0, 8)}`;
  }

  return slug;
}
