import { DuplicateEmailError, InvalidRegistrationInputError } from "./model";
import type { AuthServiceError, RegisterBody, RegisterSuccess } from "./model";

export interface AuthRepository {
  emailExists(email: string): Promise<boolean>;
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
}

export interface AuthServiceOptions {
  repository: AuthRepository;
  hashPassword: (password: string) => Promise<string>;
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
