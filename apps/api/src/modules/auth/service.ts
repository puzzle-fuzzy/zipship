import { DuplicateEmailError, InvalidCredentialsError, InvalidRegistrationInputError, UnauthorizedError } from "./model";
import type { AuthServiceError, LoginBody, LoginSuccess, MeHeaders, MeSuccess, RegisterBody, RegisterSuccess } from "./model";
import { AuditService } from "../audit/service";
import type { AuditRepository } from "../audit/service";

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
}

function normalizeName(name: string): string | null {
  const normalized = name.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeEmail(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}

function createDefaultOrganizationSlug(email: string): string {
  return email
    .split("@")[0]
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/_+/g, "-");
}

function parseBearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;

  const [scheme, token] = authorization.split(" ");

  if (scheme !== "Bearer" || !token) return null;

  return token;
}
