import { DuplicateEmailError, InvalidCredentialsError, InvalidRegistrationInputError } from "./model";
import type { AuthServiceError, LoginBody, LoginSuccess, RegisterBody, RegisterSuccess } from "./model";

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
  }): Promise<RegisterSuccess>;
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
}

export interface AuthServiceOptions {
  repository: AuthRepository;
  hashPassword: (password: string) => Promise<string>;
  verifyPassword: (password: string, hash: string) => Promise<boolean>;
  createRefreshToken: () => string;
  hashRefreshToken: (token: string) => Promise<string>;
  now: () => Date;
}

export class AuthService {
  constructor(private readonly options: AuthServiceOptions) {}

  async register(input: RegisterBody): Promise<RegisterSuccess | AuthServiceError> {
    const name = normalizeName(input.name);
    const email = normalizeEmail(input.email);

    if (!name || !email || input.password.length < 8) {
      return new InvalidRegistrationInputError();
    }

    if (await this.options.repository.emailExists(email)) {
      return new DuplicateEmailError();
    }

    const passwordHash = await this.options.hashPassword(input.password);

    return this.options.repository.createUserWithDefaultOrganization({
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
  }

  async login(input: LoginBody): Promise<LoginSuccess | AuthServiceError> {
    const email = normalizeEmail(input.email);

    if (!email || input.password.length < 8) {
      return new InvalidCredentialsError();
    }

    const user = await this.options.repository.findUserByEmail(email);

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
    const session = await this.options.repository.createSession({
      userId: user.id,
      clientType: input.clientType ?? "web",
      refreshTokenHash,
      expiresAt,
    });

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
