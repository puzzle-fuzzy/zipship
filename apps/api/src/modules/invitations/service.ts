import type { InvitationsHeaders, InvitationsParams, InviteBody, InviteSuccess, InvitationsServiceError } from "./model";
import {
  InvitationsUnauthorizedError,
  InvitationsForbiddenError,
  InvitationsUserNotFoundError,
  InvitationsAlreadyMemberError,
  InvitationsPendingError,
} from "./model";
import type { AuthRepository } from "../auth/service";
import { EmailService } from "../email/service";
import { PermissionService } from "../permissions/service";
import type { MemberRole } from "../permissions/model";

export interface InvitationsRepository {
  createInvitation(input: {
    organizationId: string;
    email: string;
    role: string;
    invitedBy: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<{ id: string; email: string; role: string; status: string }>;
  findPendingByEmail(input: { organizationId: string; email: string }): Promise<{ id: string } | null>;
}

export interface InvitationsServiceOptions {
  sessionRepository: Pick<AuthRepository, "findSessionByRefreshTokenHash">;
  authRepository: Pick<AuthRepository, "findUserByEmail">;
  organizationsRepository: {
    findMembership(input: { organizationId: string; userId: string }): Promise<{ role: MemberRole } | null>;
    findOrganizationById(organizationId: string): Promise<{ name: string } | null>;
  };
  invitationsRepository: InvitationsRepository;
  emailService?: EmailService;
  hashRefreshToken: (token: string) => Promise<string>;
  hashToken: (token: string) => Promise<string>;
  randomToken: () => string;
  invitationBaseUrl?: string;
  now: () => Date;
  permissions?: PermissionService;
}

export class InvitationsService {
  private readonly permissions: PermissionService;

  constructor(private readonly options: InvitationsServiceOptions) {
    this.permissions = options.permissions ?? new PermissionService();
  }

  async invite(
    headers: InvitationsHeaders,
    params: InvitationsParams,
    body: InviteBody,
  ): Promise<InviteSuccess | InvitationsServiceError> {
    const session = await this.findSession(headers);
    if (!session) return new InvitationsUnauthorizedError();

    // Check permission: only owner/admin can invite
    const membership = await this.options.organizationsRepository.findMembership({
      organizationId: params.organizationId,
      userId: session.user.id,
    });
    if (!membership) return new InvitationsForbiddenError();
    if (!this.permissions.can(membership.role, "invite_member")) return new InvitationsForbiddenError();

    // Look up user by email
    const invitedUser = await this.options.authRepository.findUserByEmail(body.email);
    if (!invitedUser) return new InvitationsUserNotFoundError();

    // Check if already a member
    const existingMembership = await this.options.organizationsRepository.findMembership({
      organizationId: params.organizationId,
      userId: invitedUser.id,
    });
    if (existingMembership) return new InvitationsAlreadyMemberError();

    // Check if invitation already pending
    const pendingInvite = await this.options.invitationsRepository.findPendingByEmail({
      organizationId: params.organizationId,
      email: body.email,
    });
    if (pendingInvite) return new InvitationsPendingError();

    // Create invitation with a token
    const token = this.options.randomToken();
    const tokenHash = await this.options.hashToken(token);
    const expiresAt = new Date(this.options.now().getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const invitation = await this.options.invitationsRepository.createInvitation({
      organizationId: params.organizationId,
      email: body.email,
      role: body.role,
      invitedBy: session.user.id,
      tokenHash,
      expiresAt,
    });

    // Send email notification
    if (this.options.emailService) {
      const org = await this.options.organizationsRepository.findOrganizationById(params.organizationId);
      await this.options.emailService.sendInvitation({
        to: body.email,
        invitedBy: session.user.name,
        organizationName: org?.name ?? "Unknown",
        role: body.role,
        token,
      });
    }

    const baseUrl = (this.options.invitationBaseUrl ?? "http://localhost:5173").replace(/\/$/, "");

    return {
      ...invitation,
      inviteUrl: `${baseUrl}/invite/${token}`,
    };
  }

  private async findSession(headers: InvitationsHeaders) {
    const token = parseBearerToken(headers.authorization);
    if (!token) return null;

    return await this.options.sessionRepository.findSessionByRefreshTokenHash(
      await this.options.hashRefreshToken(token),
      this.options.now(),
    );
  }
}

function parseBearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const [scheme, token] = authorization.split(" ");
  if (scheme.toLowerCase() !== "bearer" || !token) return null;
  return token;
}
