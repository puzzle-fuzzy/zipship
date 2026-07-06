export interface EmailServiceOptions {
  /** Base URL of the console app, used to build invitation links */
  appBaseUrl: string;
}

/**
 * Email service for ZipShip.
 *
 * In development, all emails are logged to console.
 * In production, configure an SMTP transport or replace with
 * a service like Resend, SendGrid, or Mailgun.
 */
export class EmailService {
  private readonly appBaseUrl: string;

  constructor(options: EmailServiceOptions) {
    this.appBaseUrl = options.appBaseUrl.replace(/\/$/, "");
  }

  /**
   * Send an invitation email to a user.
   * For now, logs to console. The appBaseUrl + /invite/:token
   * is the link the user can visit to accept the invitation.
   */
  async sendInvitation(input: {
    to: string;
    invitedBy: string;
    organizationName: string;
    role: string;
    token: string;
  }): Promise<void> {
    const inviteLink = `${this.appBaseUrl}/invite/${input.token}`;

    console.log("");
    console.log("═══════════════════════════════════════════");
    console.log("  📧 Invitation Email (development mode)");
    console.log("═══════════════════════════════════════════");
    console.log(`  To:           ${input.to}`);
    console.log(`  Invited by:   ${input.invitedBy}`);
    console.log(`  Organization: ${input.organizationName}`);
    console.log(`  Role:         ${input.role}`);
    console.log(`  Link:         ${inviteLink}`);
    console.log("───────────────────────────────────────────");
    console.log(`  In production, this email would be sent`);
    console.log(`  via SMTP or a transactional email service.`);
    console.log("═══════════════════════════════════════════");
    console.log("");
  }
}
