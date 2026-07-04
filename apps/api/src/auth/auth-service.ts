export interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

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
  }): Promise<{
    user: {
      id: string;
      name: string;
      email: string;
    };
    organization: {
      id: string;
      name: string;
      slug: string;
    };
    member: {
      id: string;
      role: "owner";
    };
  }>;
}

export class DuplicateEmailError extends Error {
  constructor(email: string) {
    super(`Email already registered: ${email}`);
    this.name = "DuplicateEmailError";
  }
}

export class InvalidRegistrationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRegistrationInputError";
  }
}

export interface AuthServiceOptions {
  repository: AuthRepository;
  hashPassword: (password: string) => Promise<string>;
}

export function createAuthService(options: AuthServiceOptions) {
  return {
    async register(input: RegisterInput) {
      const name = normalizeName(input.name);
      const email = normalizeEmail(input.email);

      if (input.password.length < 8) {
        throw new InvalidRegistrationInputError("Password must be at least 8 characters long");
      }

      if (await options.repository.emailExists(email)) {
        throw new DuplicateEmailError(email);
      }

      const passwordHash = await options.hashPassword(input.password);

      return options.repository.createUserWithDefaultOrganization({
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
    },
  };
}

function normalizeName(name: string): string {
  const normalized = name.trim();

  if (!normalized) {
    throw new InvalidRegistrationInputError("Name is required");
  }

  return normalized;
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new InvalidRegistrationInputError("Email is invalid");
  }

  return normalized;
}

function createDefaultOrganizationSlug(email: string): string {
  return email
    .split("@")[0]
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/_+/g, "-");
}
