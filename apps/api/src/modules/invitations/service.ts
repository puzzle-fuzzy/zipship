import { parseBearerToken } from "../../lib/auth";
import type {
  InvitationsHeaders,
  InvitationsParams,
  InvitationRevokeParams,
  InvitationTokenParams,
  InviteBody,
  InviteSuccess,
  InvitationList,
  InvitationsServiceError,
} from "./model";
import {
  InvitationsUnauthorizedError,
  InvitationsForbiddenError,
  InvitationsUserNotFoundError,
  InvitationsAlreadyMemberError,
  InvitationsPendingError,
  InvitationsNotFoundError,
  InvitationsExpiredError,
  InvitationsAlreadyAcceptedError,
  InvitationsWrongUserError,
} from "./model";
import type { AuthRepository } from "../auth/service";
import type { EmailService } from "../email/service";
import { PermissionService } from "../permissions/service";
import type { MemberRole } from "../permissions/model";

export interface InvitationRecord {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  status: string;
  expiresAt: Date;
}

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
  listInvitations(organizationId: string): Promise<Array<{
    id: string;
    email: string;
    role: string;
    status: string;
    createdAt: Date;
    expiresAt: Date;
  }>>;
  revokeInvitation(input: { organizationId: string; invitationId: string }): Promise<boolean>;
  findInvitationByTokenHash(tokenHash: string): Promise<InvitationRecord | null>;
  markInvitationStatus(input: {
    tokenHash: string;
    status: "accepted" | "revoked" | "expired";
    acceptedAt?: Date;
  }): Promise<void>;
  createMembership(input: { organizationId: string; userId: string; role: string }): Promise<void>;
}

export interface InvitationsServiceOptions {
  sessionRepository: Pick<AuthRepository, "findSessionByRefreshTokenHash">;
  authRepository: Pick<AuthRepository, "findUserByEmail">;
  organizationsRepository: {
    findMembership(input: { organizationId: string; userId: string }): Promise<{ role: MemberRole } | null>;
    findOrganizationById(organizationId: string): Promise<{ name: string } | null>;
  };
  invitationsRepository: InvitationsRepository;
  emailService?: Pick<EmailService, "sendInvitation">;
  hashRefreshToken: (token: string) => Promise<string>;
  hashToken: (token: string) => Promise<string>;
  randomToken: () => string;
  invitationBaseUrl: string;
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

    const membership = await this.options.organizationsRepository.findMembership({
      organizationId: params.organizationId,
      userId: session.user.id,
    });
    if (!membership) return new InvitationsForbiddenError();
    if (!this.permissions.can(membership.role, "invite_member")) return new InvitationsForbiddenError();

    const invitedUser = await this.options.authRepository.findUserByEmail(body.email);
    if (!invitedUser) return new InvitationsUserNotFoundError();

    const existingMembership = await this.options.organizationsRepository.findMembership({
      organizationId: params.organizationId,
      userId: invitedUser.id,
    });
    if (existingMembership) return new InvitationsAlreadyMemberError();

    const pendingInvite = await this.options.invitationsRepository.findPendingByEmail({
      organizationId: params.organizationId,
      email: body.email,
    });
    if (pendingInvite) return new InvitationsPendingError();

    const token = this.options.randomToken();
    const tokenHash = await this.options.hashToken(token);
    const expiresAt = new Date(this.options.now().getTime() + 7 * 24 * 60 * 60 * 1000);

    const invitation = await this.options.invitationsRepository.createInvitation({
      organizationId: params.organizationId,
      email: body.email,
      role: body.role,
      invitedBy: session.user.id,
      tokenHash,
      expiresAt,
    });

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

    const baseUrl = this.options.invitationBaseUrl.replace(/\/$/, "");
    return { ...invitation, inviteUrl: `${baseUrl}/invite/${token}` };
  }

  /** List pending invitations for an organization (any member may view). */
  async list(
    headers: InvitationsHeaders,
    params: InvitationsParams,
  ): Promise<InvitationList | InvitationsServiceError> {
    const session = await this.findSession(headers);
    if (!session) return new InvitationsUnauthorizedError();

    const membership = await this.options.organizationsRepository.findMembership({
      organizationId: params.organizationId,
      userId: session.user.id,
    });
    if (!membership) return new InvitationsForbiddenError();
    if (!this.permissions.can(membership.role, "view_organization")) return new InvitationsForbiddenError();

    const invitations = await this.options.invitationsRepository.listInvitations(params.organizationId);
    return {
      invitations: invitations.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        status: i.status,
        createdAt: i.createdAt.toISOString(),
        expiresAt: i.expiresAt.toISOString(),
      })),
    };
  }

  /** Revoke (cancel) a pending invitation. Owner/admin only. */
  async revoke(
    headers: InvitationsHeaders,
    params: InvitationRevokeParams,
  ): Promise<{ ok: true } | InvitationsServiceError> {
    const session = await this.findSession(headers);
    if (!session) return new InvitationsUnauthorizedError();

    const membership = await this.options.organizationsRepository.findMembership({
      organizationId: params.organizationId,
      userId: session.user.id,
    });
    if (!membership) return new InvitationsForbiddenError();
    if (!this.permissions.can(membership.role, "manage_member")) return new InvitationsForbiddenError();

    const found = await this.options.invitationsRepository.revokeInvitation({
      organizationId: params.organizationId,
      invitationId: params.invitationId,
    });
    if (!found) return new InvitationsNotFoundError();
    return { ok: true };
  }

  /**
   * Accept an invitation by its token. The caller must be authenticated and
   * their email must match the invited email. Creates the membership and marks
   * the invitation accepted.
   */
  async accept(
    headers: InvitationsHeaders,
    params: InvitationTokenParams,
  ): Promise<{ ok: true; organizationId: string } | InvitationsServiceError> {
    const session = await this.findSession(headers);
    if (!session) return new InvitationsUnauthorizedError();

    const tokenHash = await this.options.hashToken(params.token);
    const invitation = await this.options.invitationsRepository.findInvitationByTokenHash(tokenHash);
    if (!invitation) return new InvitationsNotFoundError();

    if (invitation.status === "accepted") return new InvitationsAlreadyAcceptedError();
    if (invitation.status !== "pending") return new InvitationsNotFoundError();

    const now = this.options.now();
    if (invitation.expiresAt <= now) {
      await this.options.invitationsRepository.markInvitationStatus({ tokenHash, status: "expired" });
      return new InvitationsExpiredError();
    }

    // Only the user the invitation was addressed to may accept it.
    if (invitation.email !== session.user.email) return new InvitationsWrongUserError();

    await this.options.invitationsRepository.createMembership({
      organizationId: invitation.organizationId,
      userId: session.user.id,
      role: invitation.role,
    });
    await this.options.invitationsRepository.markInvitationStatus({
      tokenHash,
      status: "accepted",
      acceptedAt: now,
    });

    return { ok: true, organizationId: invitation.organizationId };
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
